import { completeAgentRun, createAgentRun, createTask } from "@/db/queries";
import { getCalendarClient, getGmailClient } from "./google-client";
import { createDraft, fetchUnreadEmails, markAsRead } from "./agents/gmail";
import {
  CalendarEvent,
  createCalendarEvent,
  fetchUpcomingEvents,
} from "./agents/calendar";
import { ActionLogEntry } from "@/db/schema";
import { analyzeWithAI } from "./agents/process-email";

export async function runAgent(userId: string) {
  const startTime = Date.now();
  const agentRun = await createAgentRun(userId);

  try {
    // 1. Gmail client
    const gmailClient = await getGmailClient(userId);
    if (!gmailClient) {
      const run = await completeAgentRun(agentRun.id, {
        status: "failed",
        summary: "Gmail not connected",
        actionsLog: [],
        emailsProcessed: 0,
        tasksCreated: 0,
        draftsCreated: 0,
        errorMessage: "Gmail integration not found or token expired",
        durationMs: Date.now() - startTime,
      });
      return { runId: run.id, status: "failed" as const, summary: "Gmail not connected" };
    }

    // 2. Fetch unread emails (max 10)
    const emails = await fetchUnreadEmails(gmailClient, 10);

    if (emails.length === 0) {
      const run = await completeAgentRun(agentRun.id, {
        status: "success",
        summary: "No unread emails to process",
        actionsLog: [],
        emailsProcessed: 0,
        tasksCreated: 0,
        draftsCreated: 0,
        durationMs: Date.now() - startTime,
      });
      return { runId: run.id, status: "success" as const, summary: "No unread emails to process" };
    }

    // 3. Calendar events (optional)
    const calendarClient = await getCalendarClient(userId);
    let upcomingEvents: CalendarEvent[] = [];
    if (calendarClient) {
      try {
        upcomingEvents = await fetchUpcomingEvents(calendarClient, 24);
      } catch (err) {
        console.error("Calendar fetch failed (non-fatal):", err);
      }
    }

    // 4. Process each email with AI
    const actionsLog: ActionLogEntry[] = [];
    let totalTasksCreated = 0;
    let totalDraftsCreated = 0;
    let totalEventsCreated = 0;

    const results = await Promise.allSettled(
      emails.map(async (email) => {
        try {
          const analysis = await analyzeWithAI(email, upcomingEvents);

          // ── Create tasks in DB ─────────────────────────────────────────
          let emailTasksCreated = 0;
          for (const item of analysis.actionItems) {
            try {
              await createTask({
                userId,
                title: item.title,
                description: item.description,
                priority: analysis.priority,
                dueDate: item.dueDate ? new Date(item.dueDate) : null,
                createdByAgent: true,
              });
              emailTasksCreated++;
            } catch (taskErr) {
              console.error("Task creation failed:", taskErr);
            }
          }

          // ── Create Gmail draft ─────────────────────────────────────────
          let draftCreated = false;
          if (analysis.needsReply && analysis.draftReply) {
            try {
              await createDraft(
                gmailClient,
                email.from,
                `Re: ${email.subject}`,
                analysis.draftReply,
                email.threadId
              );
              draftCreated = true;
            } catch (draftErr) {
              console.error("Draft creation failed:", draftErr);
            }
          }

          // ── Create calendar events ─────────────────────────────────────
          let emailEventsCreated = 0;
          if (calendarClient && analysis.calendarEvents.length > 0) {
            for (const event of analysis.calendarEvents) {
              try {
                await createCalendarEvent(calendarClient, event);
                emailEventsCreated++;
              } catch (eventErr) {
                console.error("Calendar event error:", eventErr);
              }
            }
          }

          // ── Mark as read ───────────────────────────────────────────────
          try {
            await markAsRead(gmailClient, email.id);
          } catch (readErr) {
            console.error("markAsRead failed (non-fatal):", readErr);
          }

          return {
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            date: email.date,
            status: "success" as const,
            // ✅ All AI fields explicitly returned so actionsLog is complete
            summary: analysis.summary,
            priority: analysis.priority,
            category: analysis.category,
            needsReply: analysis.needsReply,
            draftReply: analysis.draftReply,       // ← was sometimes lost
            actionItems: analysis.actionItems,     // ← was sometimes lost
            calendarEvents: analysis.calendarEvents,
            tasksCreated: emailTasksCreated,
            draftCreated,
            eventsCreated: emailEventsCreated,
          };
        } catch (error) {
          console.error(`Email ${email.id} processing failed:`, error);
          return {
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            date: email.date,
            status: "error" as const,
            summary: "Processing failed",
            priority: "medium" as const,
            category: "other" as const,
            needsReply: false,
            draftReply: null,
            actionItems: [],
            calendarEvents: [],
            tasksCreated: 0,
            draftCreated: false,
            eventsCreated: 0,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      })
    );

    // 5. Aggregate results into actionsLog
    for (const result of results) {
      if (result.status === "fulfilled") {
        const entry = result.value;

        // ✅ Spread all fields including draftReply + actionItems into the log
        actionsLog.push({
          emailId: entry.emailId,
          subject: entry.subject,
          from: entry.from,
          date: entry.date,
          status: entry.status,
          summary: entry.summary,
          priority: entry.priority,
          category: entry.category,
          needsReply: entry.needsReply,
          draftReply: entry.draftReply ?? null,
          actionItems: entry.actionItems ?? [],
          calendarEvents: entry.calendarEvents ?? [],
          tasksCreated: entry.tasksCreated ?? 0,
          draftCreated: entry.draftCreated ?? false,
          eventsCreated: entry.eventsCreated ?? 0,
          error: (entry as any).error,
        } as ActionLogEntry);

        if (entry.status === "success") {
          totalTasksCreated += entry.tasksCreated ?? 0;
          if (entry.draftCreated) totalDraftsCreated++;
          totalEventsCreated += entry.eventsCreated ?? 0;
        }
      } else {
        // Promise itself rejected (shouldn't happen with inner try/catch, but be safe)
        console.error("Unhandled rejection in email processing:", result.reason);
      }
    }

    const successCount = actionsLog.filter((e) => e.status === "success").length;
    const errorCount   = actionsLog.filter((e) => e.status === "error").length;
    const summary = `Processed ${successCount} emails, ${errorCount} errors. Tasks: ${totalTasksCreated}, Drafts: ${totalDraftsCreated}`;

    // 6. Complete run
    const run = await completeAgentRun(agentRun.id, {
      status: successCount > 0 ? "success" : "failed",
      summary,
      actionsLog,
      emailsProcessed: successCount,
      tasksCreated: totalTasksCreated,
      draftsCreated: totalDraftsCreated,
      durationMs: Date.now() - startTime,
    });

    return {
      runId: run.id,
      status: successCount > 0 ? ("success" as const) : ("failed" as const),
      summary,
      stats: { totalTasksCreated, totalDraftsCreated, totalEventsCreated },
    };

  } catch (error) {
    console.error("Agent top-level error:", error);
    const run = await completeAgentRun(agentRun.id, {
      status: "failed",
      summary: "Agent crashed unexpectedly",
      actionsLog: [],
      emailsProcessed: 0,
      tasksCreated: 0,
      draftsCreated: 0,
      durationMs: Date.now() - startTime,
    });
    return { runId: run.id, status: "failed" as const, summary: "Agent crashed" };
  }
}