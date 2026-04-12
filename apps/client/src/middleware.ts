import { NextRequest, NextResponse } from "next/server";

function normalizePath(pathname: string): string {
  return pathname.replace(/\/{2,}/g, "/");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.includes("webhook")) {
    return NextResponse.next();
  }

  const normalizedPathname = normalizePath(pathname);

  if (normalizedPathname !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = normalizedPathname;

    console.warn(
      `[Webhook][Middleware] normalized path from=${pathname} to=${normalizedPathname}`,
    );

    return NextResponse.redirect(url, 307);
  }

  console.info(
    `[Webhook][Middleware] method=${request.method} path=${pathname}`,
  );

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
