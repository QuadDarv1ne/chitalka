import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/hooks/use-auth";
import { ResetPasswordWatcher } from "@/components/auth/reset-password-watcher";
import { VerifyEmailWatcher } from "@/components/auth/verify-email-watcher";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Читалка — удобная читалка книг",
  description: "Удобная и функциональная читалка для EPUB, FB2, PDF, TXT, Markdown. Локальное хранение, темы оформления, закладки.",
  keywords: ["читалка", "epub", "fb2", "pdf", "txt", "книги", "reader"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
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
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
          <ResetPasswordWatcher />
          <VerifyEmailWatcher />
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
