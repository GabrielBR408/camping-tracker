import { getStore } from "@netlify/blobs";

// Camping tracker API (single endpoint: /api/trip)
//
//   GET  /api/trip                 -> live trip JSON (public)
//   GET  /api/trip?admin=1         -> { trip, proposals }  (organizer password required)
//   POST /api/trip  { action: ... }:
//        "propose"  (public)  { by, note, trip }   -> queues a pending suggestion + emails the organizer
//        "save"     (admin)   { trip }             -> publishes trip live immediately
//        "approve"  (admin)   { id }               -> publishes a pending suggestion, removes it
//        "reject"   (admin)   { id }               -> discards a pending suggestion

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const isAdmin = (req) => {
  const expected = process.env.EDIT_PASSWORD;
  return !!expected && req.headers.get("x-edit-password") === expected;
};

export default async (req) => {
  const store = getStore("camping-trip");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const trip = await store.get("trip", { type: "json" });
    if (url.searchParams.get("admin") === "1") {
      if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);
      const proposals = (await store.get("proposals", { type: "json" })) || [];
      return json({ trip: trip ?? null, proposals });
    }
    return json(trip ?? null);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const action = body.action || "save";

    // ---------- Public: a guest proposes an edit ----------
    if (action === "propose") {
      if (!body.trip || typeof body.trip !== "object") return json({ error: "missing trip" }, 400);
      const by = String(body.by || "").trim().slice(0, 80) || "Someone";
      const note = String(body.note || "").trim().slice(0, 500);
      const proposals = (await store.get("proposals", { type: "json" })) || [];
      const proposal = {
        id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        by, note, trip: body.trip, createdAt: new Date().toISOString(),
      };
      proposals.push(proposal);
      await store.setJSON("proposals", proposals);
      await notifyOrganizer(proposal, url.origin).catch((e) => console.error("notify failed", e));
      return json({ ok: true });
    }

    // ---------- Everything below requires the organizer password ----------
    if (!isAdmin(req)) return json({ error: "unauthorized" }, 401);

    if (action === "save") {
      if (!body.trip) return json({ error: "missing trip" }, 400);
      await store.setJSON("trip", body.trip);
      return json({ ok: true });
    }

    if (action === "approve") {
      const proposals = (await store.get("proposals", { type: "json" })) || [];
      const p = proposals.find((x) => x.id === body.id);
      if (!p) return json({ error: "not found" }, 404);
      await store.setJSON("trip", p.trip);
      await store.setJSON("proposals", proposals.filter((x) => x.id !== body.id));
      return json({ ok: true, trip: p.trip });
    }

    if (action === "reject") {
      const proposals = (await store.get("proposals", { type: "json" })) || [];
      await store.setJSON("proposals", proposals.filter((x) => x.id !== body.id));
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  }

  return json({ error: "method not allowed" }, 405);
};

// Emails the organizer via Web3Forms (free). Needs the WEB3FORMS_KEY env var,
// tied to the email address that should receive notifications. If the key is
// missing, the suggestion is still saved — it just won't email.
async function notifyOrganizer(proposal, origin) {
  const key = process.env.WEB3FORMS_KEY;
  if (!key) return;

  const reviewUrl = `${origin}/?review=1`;
  const message =
    `${proposal.by} suggested an edit to the camping trip.\n` +
    (proposal.note ? `\nTheir note: "${proposal.note}"\n` : "") +
    `\nReview & approve: ${reviewUrl}\n` +
    `\n(Open the page, tap "Organizer", enter your password, and you'll see the pending suggestion.)`;

  await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      access_key: key,
      from_name: "Camping Tracker",
      subject: `🏕️ Camping edit suggested by ${proposal.by}`,
      message,
    }),
  });
}

export const config = { path: "/api/trip" };
