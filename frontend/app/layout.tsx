import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700"]
});

const ibmPlex = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["300", "400", "500", "600"]
});

export const metadata: Metadata = {
  title: "Toronto Student Housing Map Assistant",
  description: "Hackathon MVP for ranked housing shortlist recommendations"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${ibmPlex.variable} bg-paper text-ink font-body`}
      >
        {children}
      </body>
    </html>
  );
}
