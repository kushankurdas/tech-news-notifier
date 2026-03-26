import nodemailer from "nodemailer";
import { Article, AppConfig } from "../types";
import { groupArticlesByTopic } from "../utils/grouper";
import { logger } from "../utils/logger";

// ─── Badge helpers ────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Breaking:    "#dc2626",
  Release:     "#2563eb",
  "Deep Dive": "#7c3aed",
  Opinion:     "#d97706",
  Security:    "#b91c1c",
  Tutorial:    "#059669",
  Miscellaneous:  "#6b7280",
};

const SENTIMENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  positive: { bg: "#dcfce7", text: "#166534", label: "▲ Positive" },
  negative: { bg: "#fee2e2", text: "#991b1b", label: "▼ Negative" },
};

function categoryBadge(category: string | undefined): string {
  if (!category) return "";
  const color = CATEGORY_COLORS[category] ?? "#6b7280";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:${color};margin-right:6px;">${category}</span>`;
}

function sentimentBadge(sentiment: string | undefined): string {
  if (!sentiment || sentiment === "neutral") return "";
  const s = SENTIMENT_COLORS[sentiment];
  if (!s) return "";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:${s.text};background:${s.bg};">${s.label}</span>`;
}

// ─── HTML builders ────────────────────────────────────────────────────────────

function buildArticleRow(a: Article): string {
  const badges = [categoryBadge(a.category), sentimentBadge(a.sentiment)]
    .filter(Boolean).join("");
  const sourceLine = (a.sources ?? [a.source]).join(" · ");

  return `
  <tr>
    <td style="padding:16px 0;border-bottom:1px solid #e5e7eb;">
      ${badges ? `<div style="margin-bottom:6px;">${badges}</div>` : ""}
      <a href="${a.url}"
         style="font-size:16px;font-weight:600;color:#1d4ed8;text-decoration:none;line-height:1.4;">
        ${a.title}
      </a>
      <p style="margin:6px 0 4px;font-size:14px;color:#374151;line-height:1.5;">
        ${a.summary ?? a.excerpt}
      </p>
      <div style="font-size:12px;color:#9ca3af;">
        ${sourceLine} &nbsp;·&nbsp; ${a.publishedAt.toLocaleString()}
      </div>
    </td>
  </tr>`;
}

function buildGroupSection(topic: string, articles: Article[]): string {
  return `
  <tr>
    <td style="padding:24px 0 8px;">
      <h2 style="margin:0;font-size:18px;color:#111827;border-left:4px solid #2563eb;padding-left:12px;">
        ${topic}
        <span style="font-size:13px;font-weight:400;color:#6b7280;margin-left:8px;">
          ${articles.length} ${articles.length === 1 ? "article" : "articles"}
        </span>
      </h2>
    </td>
  </tr>
  ${articles.map(buildArticleRow).join("")}`;
}

function buildHtmlEmail(articles: Article[], config: AppConfig): string {
  const groups = groupArticlesByTopic(articles, config.ai.minGroupSize);
  const isGrouped = !(groups.length === 1 && groups[0].topic === "Tech News");

  const body = isGrouped
    ? groups.map((g) => buildGroupSection(g.topic, g.articles)).join("")
    : articles.map(buildArticleRow).join("");

  const subtitle = isGrouped
    ? `${articles.length} new ${articles.length === 1 ? "story" : "stories"} across ${groups.length} topics`
    : `${articles.length} new ${articles.length === 1 ? "article" : "articles"}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:24px;margin:0;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <h1 style="font-size:22px;color:#111827;margin:0 0 4px;">Tech News Update</h1>
    <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">${subtitle}</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${body}
    </table>
    <p style="margin-top:32px;font-size:12px;color:#9ca3af;text-align:center;">
      Sent by Tech News Notifier &nbsp;·&nbsp; Made with ❤️
    </p>
  </div>
</body>
</html>`;
}

function buildTextEmail(articles: Article[], config: AppConfig): string {
  const groups = groupArticlesByTopic(articles, config.ai.minGroupSize);
  const isGrouped = !(groups.length === 1 && groups[0].topic === "Tech News");

  if (isGrouped) {
    return groups.map((g) => {
      const header = `── ${g.topic} (${g.articles.length}) ──`;
      const items = g.articles
        .map((a, i) =>
          `  ${i + 1}. [${a.category ?? a.source}] ${a.title}\n     ${a.summary ?? a.excerpt}\n     ${a.url}`
        )
        .join("\n\n");
      return `${header}\n\n${items}`;
    }).join("\n\n\n");
  }

  return articles
    .map((a, i) => `${i + 1}. [${a.source}] ${a.title}\n   ${a.summary ?? a.excerpt}\n   ${a.url}`)
    .join("\n\n");
}

// ─── Public notifier ──────────────────────────────────────────────────────────

export async function sendEmailNotification(
  articles: Article[],
  config: AppConfig
): Promise<void> {
  const { email } = config.notifiers;
  if (!email.enabled || articles.length === 0) return;

  if (email.to.length === 0) {
    logger.warn("Email notifier: EMAIL_TO is not set. Skipping.");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: email.smtp.host,
      port: email.smtp.port,
      secure: email.smtp.secure,
      auth: email.smtp.user
        ? { user: email.smtp.user, pass: email.smtp.pass }
        : undefined,
    });

    const uniqueSources = [...new Set(articles.map((a) => a.source))].slice(0, 3);
    const subject = `[Tech News] ${articles.length} new ${articles.length === 1 ? "article" : "articles"} from ${uniqueSources.join(", ")}`;

    await transporter.sendMail({
      from: email.from,
      to: email.to.join(", "),
      subject,
      text: buildTextEmail(articles, config),
      html: buildHtmlEmail(articles, config),
    });

    logger.info(`Email sent to ${email.to.join(", ")} (${articles.length} articles)`);
  } catch (err: any) {
    logger.error(`Email notification failed: ${err.message}`);
  }
}
