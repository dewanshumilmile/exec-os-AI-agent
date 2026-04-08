"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProcessedEmail } from "@/db/schema";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  ListTodo,
  Mail,
  User,
} from "lucide-react";
import { useState } from "react";

// ─── Color maps ───────────────────────────────────────────────────────────────

const priorityColors: Record<string, string> = {
  high:   "bg-destructive text-destructive-foreground",
  medium: "bg-yellow-500/80 text-white",
  low:    "bg-primary/60 text-primary-foreground",
};

const categoryColors: Record<string, string> = {
  work:         "bg-blue-500/20 text-blue-400 border-blue-500/30",
  personal:     "bg-purple-500/20 text-purple-400 border-purple-500/30",
  newsletter:   "bg-muted text-muted-foreground",
  notification: "bg-muted text-muted-foreground",
  spam:         "bg-destructive/20 text-destructive border-destructive/30",
  other:        "bg-muted text-muted-foreground",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a date string or Date for display, safely (avoids hydration mismatch). */
function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  try {
    const d = new Date(value);
    // Use a locale-agnostic format to prevent SSR/client mismatch
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return String(value);
  }
}

/** Extract sender display name from "Name <email>" format. */
function parseSenderName(from: string | null | undefined): string {
  if (!from) return "Unknown";
  const nameMatch = from.match(/^([^<]+)</);
  if (nameMatch) return nameMatch[1].trim().replace(/"/g, "");
  return from;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EmailDetail({ email }: { email: ProcessedEmail }) {
  const [expanded, setExpanded] = useState(false);

  const senderName = parseSenderName(email.from);

  // Safely cast JSON fields (Drizzle stores them as unknown)
  const actionItems: Array<{ title: string; description: string; dueDate: string | null }> =
    Array.isArray(email.actionItems) ? (email.actionItems as any) : [];

  const calendarEvents: Array<{
    title: string;
    description: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
  }> = Array.isArray(email.calendarEvents) ? (email.calendarEvents as any) : [];

  const hasDetails =
    actionItems.length > 0 ||
    !!email.draftReply ||
    calendarEvents.length > 0;

  return (
    <Card className="email-card overflow-hidden">
      {/* ── Clickable header ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-expanded={expanded}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">

              {/* Subject + badges row */}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="email-subject font-medium truncate">
                  {email.subject || "(No subject)"}
                </h3>

                {email.priority && (
                  <Badge className={`text-xs ${priorityColors[email.priority] ?? "bg-muted"}`}>
                    {email.priority}
                  </Badge>
                )}

                {email.category && (
                  <Badge variant="outline" className={`text-xs ${categoryColors[email.category] ?? ""}`}>
                    {email.category}
                  </Badge>
                )}

                {email.draftCreated && (
                  <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                    <FileText className="w-3 h-3 mr-1" />
                    Draft
                  </Badge>
                )}

                {(email.tasksCreated ?? 0) > 0 && (
                  <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/30">
                    <ListTodo className="w-3 h-3 mr-1" />
                    {email.tasksCreated} task{email.tasksCreated !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>

              {/* From + date */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-2">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {senderName}
                </span>
                <span className="flex items-center gap-1" suppressHydrationWarning>
                  <Clock className="w-3 h-3" />
                  {formatDate(email.processedAt)}
                </span>
              </div>

              {/* Summary */}
              {email.summary && email.summary !== "AI failed" && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {email.summary}
                </p>
              )}

              {/* AI failed warning */}
              {email.summary === "AI failed" && (
                <p className="text-xs text-destructive/80 italic">
                  AI analysis failed for this email.
                </p>
              )}
            </div>

            {/* Chevron */}
            <div className="flex-shrink-0 mt-1 text-muted-foreground">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </CardContent>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">

          {/* Action Items */}
          {actionItems.length > 0 && (
            <section>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                <ListTodo className="w-4 h-4 text-orange-400" />
                Action Items
              </h4>
              <ul className="space-y-2">
                {actionItems.map((item, i) => (
                  <li key={i} className="rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    )}
                    {/* ✅ Fixed: show actual dueDate from the item, not processedAt */}
                    {item.dueDate && (
                      <p className="text-xs text-orange-400 mt-1">
                        Due: {item.dueDate}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Draft Reply */}
{email.draftReply && (
  <section>
    <h4 className="flex items-center gap-1.5 text-sm font-semibold mb-2">
      <Mail className="w-4 h-4 text-green-400" />
      Draft Reply
    </h4>

    <div
      className="rounded-md border border-green-500/20 bg-green-500/5 p-3 cursor-pointer hover:bg-green-500/10 transition"
      onClick={() =>
        window.open("https://mail.google.com/mail/u/0/#drafts", "_blank")
      }
    >
      <p className="text-xs text-green-400 mb-1">
        Click to open in Gmail →
      </p>

      <p className="text-sm whitespace-pre-wrap text-foreground/90">
        {email.draftReply}
      </p>
    </div>
  </section>
)}

          {calendarEvents.map((event, i) => {
  // ✅ Safe date handling
  const safeDate = event.date || new Date().toISOString().split("T")[0];

  const formattedDate = safeDate.replace(/-/g, "");

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    event.title || "Event"
  )}&dates=${formattedDate}/${formattedDate}&details=${encodeURIComponent(
    event.description || ""
  )}`;

  return (
    <li
      key={i}
      className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 cursor-pointer hover:bg-blue-500/10 transition"
      onClick={() => window.open(url, "_blank")}
    >
      <p className="text-xs text-blue-400 mb-1">
        Click to open in Calendar →
      </p>

      <p className="text-sm font-medium">
        {event.title || "Untitled Event"}
      </p>

      <p className="text-xs text-muted-foreground mt-0.5">
        {safeDate}
        {event.startTime && ` · ${event.startTime}`}
        {event.endTime && ` – ${event.endTime}`}
      </p>

      {event.description && (
        <p className="text-xs text-muted-foreground mt-1">
          {event.description}
        </p>
      )}
    </li>
  );
})}
          {/* Nothing to show */}
          {!hasDetails && email.status !== "error" && (
            <p className="text-xs text-muted-foreground italic">
              No action items, draft reply, or calendar events for this email.
            </p>
          )}

          {/* Error state */}
          {email.status === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-xs text-destructive">
                Error: {(email as any).error ?? "Unknown processing error"}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}