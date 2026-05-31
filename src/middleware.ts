import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isLoginPage = req.nextUrl.pathname === '/login';
  const isApiAuth = req.nextUrl.pathname.startsWith('/api/auth');
  const isPublicApi =
    req.nextUrl.pathname.startsWith('/api/telegram') ||
    req.nextUrl.pathname.startsWith('/api/sse') ||
    req.nextUrl.pathname.startsWith('/api/video') ||
    req.nextUrl.pathname.startsWith('/api/consensus') ||
    req.nextUrl.pathname.startsWith('/api/memory') ||
    req.nextUrl.pathname.startsWith('/api/embeddings') ||
    req.nextUrl.pathname.startsWith('/api/files') ||
    req.nextUrl.pathname.startsWith('/api/browser') ||
    req.nextUrl.pathname.startsWith('/api/calendar') ||
    req.nextUrl.pathname.startsWith('/api/email');
    req.nextUrl.pathname.startsWith('/api/supervisor') ||
    req.nextUrl.pathname.startsWith('/api/lifecycle') ||
    req.nextUrl.pathname.startsWith('/api/planner');

  if (isApiAuth || isPublicApi) return NextResponse.next();
  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};