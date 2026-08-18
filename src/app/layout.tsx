import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/hooks/use-auth";
import { ResetPasswordWatcher } from "@/components/auth/reset-password-watcher";
import { VerifyEmailWatcher } from "@/components/auth/verify-email-watcher";
import { PwaSetup } from "@/components/pwa/pwa-setup";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: "Читалка — удобная читалка книг",
  description: "Удобная и функциональная читалка для EPUB, FB2, PDF, TXT, Markdown. Локальное хранение, темы оформления, закладки.",
  keywords: ["читалка", "epub", "fb2", "pdf", "txt", "книги", "reader"],
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
  openGraph: {
    title: "Читалка — удобная читалка книг",
    description: "Удобная читалка для EPUB, FB2, PDF, TXT, Markdown с локальным хранением.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Читалка — удобная читалка книг",
    description: "Удобная читалка для EPUB, FB2, PDF, TXT, Markdown с локальным хранением.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <PwaSetup />
        <ErrorBoundary>
          <AuthProvider>
            <ThemeProvider>{children}</ThemeProvider>
            <Suspense fallback={null}>
              <ResetPasswordWatcher />
            </Suspense>
            <Suspense fallback={null}>
              <VerifyEmailWatcher />
            </Suspense>
          </AuthProvider>
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}
