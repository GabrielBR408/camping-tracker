import { getStore } from "@netlify/blobs";

// Single endpoint for reading + writing the trip data.
//   GET  /api/trip            -> returns the saved trip JSON (or null if none yet)
//   POST /api/trip            -> saves trip JSON (requires the x-edit-password header)
export default async (req) => {
  const store = getStore("camping-trip");

  if (req.method === "GET") {
    const data = await store.get("trip", { type: "json" });
    return Response.json(data ?? null, {
      headers: { "cache-control": "no-store" },
    });
  }

  if (req.method === "POST") {
    const expected = process.env.EDIT_PASSWORD;
    const provided = req.headers.get("x-edit-password");
    if (!expected) {
      return new Response("Server missing EDIT_PASSWORD env var", { status: 500 });
    }
    if (provided !== expected) {
      return new Response("Wrong edit password", { status: 401 });
    }
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    await store.setJSON("trip", body);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/trip" };
