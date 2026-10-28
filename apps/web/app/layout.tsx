import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { ToastViewport } from "@/components/ui/toast";
import { ConfirmDialogHost } from "@/components/ui/confirm-dialog";
import { NetworkStatusBar } from "@/components/ui/network-status-bar";
import { NetworkMonitor } from "@/components/ui/network-monitor";
import { SITE, SITE_URL } from "@/lib/site-info";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Browser bar / status bar colours. Dark should match the `--background` value
// inside the `.dark` block of globals.css; change it here if it differs.
const THEME_COLOR_LIGHT = SITE.themeColor;
const THEME_COLOR_DARK = "#0f172a";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE.name,
  description: SITE.description,
  // Everything is private by default. Only /about overrides this to be indexable.
  robots: { index: false, follow: false },
  applicationName: SITE.name,
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: SITE.shortName,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR_LIGHT },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR_DARK },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-background text-foreground antialiased`}
      >
        <RegisterServiceWorker />
        {/* "system" follows the phone's setting until the user picks Light or Dark in the app. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <QueryProvider>
            <NetworkStatusBar />
            {children}
            <ToastViewport />
            <ConfirmDialogHost />
            <NetworkMonitor />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}