import { Env, GrafanaWebhook } from "./types";

async function handleGrafanaWebhook(req: Request, forwardingUrl: string) {
  const body = await req.json();
  const { status, alerts } = body as GrafanaWebhook;

  if (!status) {
    return new Response("No status found", { status: 400 });
  }

  const alertsText = alerts
    .map((alert) => {
      const status = alert.status === "firing" ? "🔴" : "🟢";
      const titleText = (alert?.labels?.alertname ?? "No title");
      const url = alert.generatorURL;

      const annotations = alert.annotations;
      const labels = alert.labels;

      const summary = annotations.summary || "No summary provided";
      const description = annotations.description || "";

      const text = `${summary}\n${description}`.trim();

      const titleUrl = url ? `[${titleText}](${url})` : titleText;
      const silenceUrl = alert.silenceURL ? ` · [(silence)](${alert.silenceURL})` : "";
      const instance = labels.instance ? ` · ${labels.instance}` : "";

      const title = `${status} ${titleUrl}${silenceUrl}${instance}`;

      return `### ${title}\n${text}`;
    })
    .join("\n\n");

  const statusCount = alerts.reduce((acc, alert) => {
    acc[alert.status] = (acc[alert.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const overallStatuses = [];

  if (statusCount.resolved > 0) overallStatuses.push(`✅ ${statusCount.resolved} resolved`);
  if (statusCount.firing > 0) overallStatuses.push(`🔥 ${statusCount.firing} firing`);

  const overallStatus = `## New Alerts! ${overallStatuses.join(", ")}`;
  let message = `${overallStatus}\n\n${alertsText}`;
  if (message.length > 2044) {
    message = message.substring(0, 2044) + "…";
  }

  const payload = {
    content: message,
  };

  await fetch(forwardingUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return new Response("OK");
}

export default {
  async fetch(req: Request, env: Env) {
    const authToken = req.headers.get("Authorization");
    if (authToken !== `Bearer ${env.TOKEN}`) return new Response("Not found", { status: 404 });

    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const url = new URL(req.url);
    const { pathname } = url;

    const pathParts = pathname.split("/").filter(Boolean);
    if (pathParts.length !== 3) return new Response("Not found", { status: 404 });

    const [action, webhookId, webhookToken] = pathParts;
    if (action !== "webhooks") return new Response("Not found", { status: 404 });

    const forwardingUrl = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;

    return handleGrafanaWebhook(req, forwardingUrl);
  },
}
