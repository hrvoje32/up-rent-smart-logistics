import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const config = getSupabasePublicConfig();
  if (!config) {
    if (process.env.NODE_ENV === "production" && request.nextUrl.pathname.startsWith("/admin")) return new NextResponse("Supabase prijava nije konfigurirana.", { status: 503 });
    return NextResponse.next();
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (entries) => {
        entries.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        entries.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (request.nextUrl.pathname.startsWith("/admin") && !data?.claims?.sub) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = { matcher: ["/admin/:path*", "/api/:path*"] };
