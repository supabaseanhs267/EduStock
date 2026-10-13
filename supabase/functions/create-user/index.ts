// supabase/functions/create-user/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lock CORS to your site:  supabase secrets set ALLOWED_ORIGIN=https://your-site.example
// (falls back to "*" if not set, same as before)
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const VALID_ROLES = ["admin", "staff"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized - No token provided" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const adminClient = createClient(supabaseUrl, Deno.env.get("SERVICE_ROLE_KEY") ?? "");

    // 1) Who is calling?
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized - Invalid token" }, 401);

    // 2) Are they an admin? Checked with the service client so it never depends on RLS.
    const { data: caller, error: roleError } = await adminClient
      .from("users").select("role, full_name").eq("id", user.id).single();
    if (roleError || caller?.role !== "admin") {
      return json({ error: "Forbidden - Admin access required" }, 403);
    }

    // 3) Validate input (never trust the browser: these rules must live here)
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const full_name = String(body.full_name ?? "").trim();
    const role = String(body.role ?? "staff").trim().toLowerCase();

    if (!email || !password || !full_name) {
      return json({ error: "Missing required fields: email, password, full_name" }, 400);
    }
    if (!EMAIL_RE.test(email)) return json({ error: "Invalid email address" }, 400);
    if (full_name.length > 100) return json({ error: "Name is too long (max 100 characters)" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (!VALID_ROLES.includes(role)) {
      return json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}` }, 400);
    }

    // 4) Create the auth user.
    // The role is NOT put in user_metadata: users can edit their own user_metadata,
    // so it must never be treated as proof of a role. The source of truth is public.users.
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (createError) return json({ error: createError.message }, 400);

    // 5) Create the profile row; undo the auth user if that fails
    const { error: insertError } = await adminClient
      .from("users")
      .insert([{ id: newUser.user.id, email, full_name, role }]);

    if (insertError) {
      await adminClient.auth.admin.deleteUser(newUser.user.id);
      return json({ error: insertError.message }, 400);
    }

    // Tell the admins (best effort: a notification problem must never fail account creation)
    const { error: notifyError } = await adminClient.from("notifications").insert({
      type: "staff_added",
      title: role === "admin" ? "New admin account" : "New staff account",
      message: `${caller.full_name ?? "An admin"} added ${full_name} (${role})`,
      link: "settings.html",
      audience: "admin",
      created_by: user.id,
    });
    if (notifyError) console.error("Could not create notification:", notifyError.message);

    return json({
      success: true,
      user: { id: newUser.user.id, email: newUser.user.email, full_name, role },
      message: `User ${full_name} created successfully`,
    });
  } catch (error) {
    console.error("Error in create-user function:", error);
    return json({ error: "Internal server error" }, 500);
  }
});