import { EmailDetail } from "@/components/agents/email-detail";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAgentRuns, getOrCreateUser } from "@/db/queries";
import { ProcessedEmail } from "@/db/schema";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  AlertCircleIcon,
  FileTextIcon,
  ListTodoIcon,
  MailIcon,
} from "lucide-react";
import { redirect } from "next/navigation";

export default async function MonitoringPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect("/sign-in");

  const clerkUser = await currentUser();
  const email = clerkUser?.emailAddresses[0].emailAddress ?? "";
  const name = clerkUser?.fullName ?? "";
  const user = await getOrCreateUser(clerkId, email, name);

  const runs = await getAgentRuns(user.id);

  // ✅ Flatten all actionsLog entries into ProcessedEmail objects.
  // Each entry already contains draftReply, actionItems, calendarEvents
  // written by the agent — we just need to pass them through correctly.
  const processedEmails: ProcessedEmail[] = [];

  for (const run of runs) {
    const log = Array.isArray(run.actionsLog) ? run.actionsLog : [];
    for (const entry of log) {
      if (!entry.emailId) continue;

      processedEmails.push({
        emailId:       entry.emailId,
        subject:       entry.subject,
        from:          entry.from,
        date:          entry.date,
        status:        entry.status,
        summary:       entry.summary ?? "",
        priority:      entry.priority,
        category:      entry.category,
        needsReply:    entry.needsReply ?? false,
        // ✅ draftReply is the actual reply text — passed directly to EmailDetail
        draftReply:    entry.draftReply ?? null,
        // ✅ draftCreated is the boolean used for stat counting
        draftCreated:  entry.draftCreated ?? false,
        actionItems:   Array.isArray(entry.actionItems) ? entry.actionItems : [],
        calendarEvents: Array.isArray(entry.calendarEvents) ? entry.calendarEvents : [],
        tasksCreated:  entry.tasksCreated ?? 0,
        eventsCreated: entry.eventsCreated ?? 0,
        error:         entry.error,
        processedAt:   run.startedAt,
      });
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalProcessed = processedEmails.length;
  const highPriority   = processedEmails.filter((e) => e.priority === "high").length;
  // ✅ Count drafts by whether draftReply text exists (more reliable than boolean flag)
  const totalDrafts    = processedEmails.filter((e) => !!e.draftReply).length;
  // ✅ Count tasks from actionItems array length (more reliable than tasksCreated counter)
  const totalTasks     = processedEmails.reduce(
    (acc, e) => acc + (e.actionItems?.length ?? 0),
    0,
  );

  return (
    <div className="page-wrapper">
      <div>
        <h1 className="page-title">Monitoring</h1>
        <p className="page-description">
          Emails processed by your AI agent with Claude&apos;s analysis.
        </p>
      </div>

      {/* Stats */}
      <div className="stats-grid-4">
        {[
          { label: "Processed",      value: totalProcessed, icon: MailIcon },
          { label: "High Priority",  value: highPriority,   icon: AlertCircleIcon },
          { label: "Drafts Created", value: totalDrafts,    icon: FileTextIcon },
          { label: "Tasks Extracted",value: totalTasks,     icon: ListTodoIcon },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="stat-card-header">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="stat-icon" />
            </CardHeader>
            <CardContent>
              <div className="stat-value">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Email list */}
      <div className="space-y-3">
        {processedEmails.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <MailIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No emails processed yet. Run the agent from the Dashboard to get started.
            </p>
          </div>
        ) : (
          processedEmails.map((email, idx) => (
            <EmailDetail
              key={`${email.emailId}-${idx}`}
              email={email}
            />
          ))
        )}
      </div>
    </div>
  );
}