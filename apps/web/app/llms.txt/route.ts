import { ABOUT_URL, SITE } from "@/lib/site-info";

export const dynamic = "force-static";

export function GET() {
  const body = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    "## About",
    `- [About ${SITE.name}](${ABOUT_URL}): what the system is and who built it`,
    "",
    "## Developer",
    `- ${SITE.developerName} (${SITE.developerHandle}), developer of fabtyna.com and schooldra.com`,
    `- [fabtyna.com](${SITE.fabtynaUrl})`,
    `- [schooldra.com](${SITE.schooldraUrl})`,
    "",
    "## Notes",
    "- The application is private and requires a login. Only the About page is public.",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}