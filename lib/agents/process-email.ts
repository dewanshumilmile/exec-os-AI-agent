import { CalendarEvent } from "./calendar";
import { ParsedEmail } from "./gmail";
import axios from "axios";
import { z } from "zod";

const emailAnalysisSchema = z.object({
  summary: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  actionItems: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      dueDate: z.string().nullable(),
    })
  ),
  needsReply: z.boolean(),
  draftReply: z.string().nullable(),
  calendarEvents: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      date: z.string(),
      startTime: z.string().nullable(),
      endTime: z.string().nullable(),
    })
  ),
  category: z.enum([
    "work",
    "personal",
    "newsletter",
    "notification",
    "spam",
    "other",
  ]),
});

export type EmailAnalysis = z.infer<typeof emailAnalysisSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip markdown fences and pull out the first {...} JSON object from text.
 * Handles models that wrap JSON in ```json ... ``` or add extra prose.
 */
function extractJSON(raw: string): string {
  // Remove fences
  let text = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

  // Find outermost { ... }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

/**
 * Smart priority: gives HIGH only when the email is genuinely actionable/urgent,
 * not just because it mentions the word "meeting" in a newsletter context.
 */
function refinePriority(
  aiPriority: string,
  subject: string,
  body: string,
  category: string
): "low" | "medium" | "high" {
  // Newsletters / notifications / spam → never high from keyword alone
  if (["newsletter", "notification", "spam"].includes(category)) {
    return aiPriority === "high" ? "medium" : (aiPriority as any) ?? "low";
  }

  const content = (subject + " " + body).toLowerCase();

  // Strong urgency signals → high
  const highSignals = [
    "urgent",
    "asap",
    "immediately",
    "deadline",
    "by tomorrow",
    "due today",
    "action required",
    "response required",
    "time sensitive",
    "meeting invite",
    "calendar invite",
    "you've been invited",
  ];

  if (highSignals.some((s) => content.includes(s))) return "high";

  // Validate AI output
  if (["low", "medium", "high"].includes(aiPriority))
    return aiPriority as "low" | "medium" | "high";

  return "medium";
}

/**
 * Ensure a draft reply is always generated when the email needs one,
 * using a context-aware fallback.
 */
function ensureDraftReply(
  needsReply: boolean,
  existingDraft: string | null,
  subject: string,
  senderName: string
): string | null {
  if (!needsReply) return null;
  if (existingDraft && existingDraft.trim().length > 20) return existingDraft;

  // Context-aware fallback
  return (
    `Hi ${senderName || "there"},\n\n` +
    `Thank you for your email regarding "${subject}". ` +
    `I've received your message and will get back to you shortly.\n\n` +
    `Best regards`
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function analyzeWithAI(
  email: ParsedEmail,
  upcomingEvents: CalendarEvent[]
): Promise<EmailAnalysis> {
  const today = new Date().toISOString().split("T")[0];

  const calendarContext =
    upcomingEvents.length > 0
      ? `\n\nUser's upcoming calendar events (next 24 h):\n` +
        upcomingEvents
          .map(
            (e) =>
              `- ${e.summary} (${e.start} → ${e.end}${
                e.location ? `, at ${e.location}` : ""
              })`
          )
          .join("\n")
      : "";

  // Truncate body to avoid token waste on huge newsletters
  const bodySnippet =
    email.body.length > 2000
      ? email.body.slice(0, 2000) + "\n...[truncated]"
      : email.body;

  const senderName =
    email.from?.split("<")[0]?.trim().replace(/"/g, "") || "there";

  const systemPrompt = `You are a structured data extractor for emails.
You MUST return ONLY a single valid JSON object — no prose, no markdown fences, no explanation.
Any extra text will break the parser. Return ONLY the JSON.`;

  const userPrompt = `Analyze this email and return a JSON object with EXACTLY these keys:

{
  "summary": "2-3 sentence summary of what the email is about",
  "priority": "low | medium | high",
  "actionItems": [
    { "title": "short task title", "description": "what needs to be done", "dueDate": "YYYY-MM-DD or null" }
  ],
  "needsReply": true | false,
  "draftReply": "full reply text if needsReply is true, otherwise null",
  "calendarEvents": [
    { "title": "event title", "description": "details", "date": "YYYY-MM-DD", "startTime": "HH:MM or null", "endTime": "HH:MM or null" }
  ],
  "category": "work | personal | newsletter | notification | spam | other"
}

PRIORITY RULES:
- high → urgent deadlines, meeting invites addressed to the user, action required today/tomorrow
- medium → work emails needing response within a few days, task assignments
- low → newsletters, notifications, FYI emails, promotional content

TASKS (actionItems) RULES:
- Extract EVERY concrete task, deadline, or follow-up mentioned
- If there are no tasks, return an empty array []
- Always populate dueDate if a date is mentioned

REPLY (draftReply) RULES:
- If needsReply is true, you MUST write a polite, professional draft reply
- Address the sender by name: ${senderName}
- draftReply must NOT be null when needsReply is true

CALENDAR EVENTS RULES:
- Only extract if the email is a meeting invite or mentions a specific scheduled event for the user
- Do NOT create calendar events for newsletters mentioning "meeting" generically
- If no events, return []

Today is: ${today}

---
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}

Body:
${bodySnippet}
${calendarContext}
---

Return ONLY the JSON object now:`;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        // claude-3-haiku is much more reliable at structured JSON than mistral-7b
        model: "anthropic/claude-3-haiku",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1200,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const raw: string =
      response.data?.choices?.[0]?.message?.content ?? "";

    let parsed: any;
    try {
      parsed = JSON.parse(extractJSON(raw));
    } catch (parseErr) {
      console.error("JSON parse failed. Raw output:\n", raw);
      throw new Error("AI returned invalid JSON");
    }

    // ── Post-process & harden ─────────────────────────────────────────────

    // Sanitise arrays
    parsed.actionItems = Array.isArray(parsed.actionItems)
      ? parsed.actionItems
      : [];
    parsed.calendarEvents = Array.isArray(parsed.calendarEvents)
      ? parsed.calendarEvents
      : [];

    // Sanitise booleans
    parsed.needsReply = Boolean(parsed.needsReply);

    // Smart priority (won't wrongly set newsletters to high)
    parsed.priority = refinePriority(
      parsed.priority,
      email.subject,
      email.body,
      parsed.category ?? "other"
    );

    // Always generate a draft reply when needed
    parsed.draftReply = ensureDraftReply(
      parsed.needsReply,
      parsed.draftReply ?? null,
      email.subject,
      senderName
    );

    // Fallback summary
    parsed.summary = parsed.summary?.trim() || email.snippet || "No summary";

    // Validate category
    const validCategories = [
      "work",
      "personal",
      "newsletter",
      "notification",
      "spam",
      "other",
    ];
    if (!validCategories.includes(parsed.category)) parsed.category = "other";

    // Zod validate (use raw parsed if schema fails — still better than crashing)
    const validated = emailAnalysisSchema.safeParse(parsed);
    if (validated.success) return validated.data;

    console.warn("Zod validation failed, using raw parsed:", validated.error.flatten());
    return parsed as EmailAnalysis;
  } catch (error: any) {
    const msg = error?.response?.data || error.message;
    console.error("AI ERROR:", msg);

    // Graceful fallback — never crash the agent run
    return {
      summary: "AI analysis failed — could not process this email.",
      priority: "medium",
      actionItems: [],
      needsReply: false,
      draftReply: null,
      calendarEvents: [],
      category: "other",
    };
  }
}