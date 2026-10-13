// supabase/functions/delete-user/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lock CORS to your site:  supabase secrets set ALLOWED_ORIGIN=https://your-site.example
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

// The main admin account can never be deleted. Same id your RLS policies use.
// Override with:  supabase secrets set MAIN_ADMIN_ID=<uuid>
const MAIN_ADMIN_ID = Deno.env.get("MAIN_ADMIN_ID") ?? "b3c2dd71-e018-4569-a17f-b0630811e3be";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const adminClient = createClient(supabaseUrl, Deno.env.get("SERVICE_ROLE_KEY") ?? "");

    // 1) Who is calling?
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    // 2) Are they an admin? (service client, independent of RLS)
    const { data: caller, error: roleError } = await adminClient
      .from("users").select("role").eq("id", user.id).single();
    if (roleError || caller?.role !== "admin") {
      return json({ error: "Forbidden - Admin access required" }, 403);
    }

    // 3) Validate the target
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    const user_id = String(body.user_id ?? "").trim();
    if (!user_id) return json({ error: "Missing user_id" }, 400);
    if (!UUID_RE.test(user_id)) return json({ error: "Invalid user_id" }, 400);
    if (user_id === user.id) return json({ error: "You cannot delete your own account" }, 400);
    if (user_id === MAIN_ADMIN_ID) return json({ error: "The main admin account cannot be deleted" }, 403);

    // 4) Remove the profile row FIRST: your RLS policies depend on it, so this cuts the
    //    person's access to all data immediately, even while their old token is still valid.
    const { error: deleteUserError } = await adminClient.from("users").delete().eq("id", user_id);
    if (deleteUserError) {
      // 23503 = foreign key: this person is referenced by existing transactions
      const message = deleteUserError.code === "23503"
        ? "This staff member appears in existing transaction records and cannot be deleted."
        : deleteUserError.message;
      return json({ error: message }, 400);
    }

    // 5) Then remove the login. "Not found" is fine (already gone).
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(user_id);
    if (deleteAuthError && deleteAuthError.status !== 404) {
      return json({
        error: "Profile removed (access is revoked) but the login could not be deleted: " +
          deleteAuthError.message + ". Try again.",
      }, 400);
    }

    return json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Error in delete-user function:", error);
    return json({ error: "Internal server error" }, 500);
  }
});