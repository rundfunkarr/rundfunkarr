import { defineConfig } from "vitepress";

const repo = "https://github.com/rundfunkarr/rundfunkarr";

export default defineConfig({
  lang: "de-DE",
  title: "RundfunkArr",
  description:
    "Rundfunk-Indexer für Sonarr und Radarr: ARD, ZDF und weitere Mediatheken automatisch laden.",
  base: "/rundfunkarr/",
  cleanUrls: true,
  srcExclude: ["README.md"],
  // Keep Vite from picking up the app's PostCSS/Tailwind config in the repository root.
  vite: { css: { postcss: {} } },
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/rundfunkarr/logo.svg" }]],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Anleitung", link: "/installation" },
      { text: "Funktionen", link: "/hls" },
      { text: "Referenz", link: "/api" },
      { text: "Releases", link: `${repo}/releases` },
    ],
    sidebar: [
      {
        text: "Erste Schritte",
        items: [
          { text: "Installation", link: "/installation" },
          { text: "Sonarr, Radarr & Prowlarr", link: "/einrichtung" },
          { text: "Konfiguration", link: "/konfiguration" },
          { text: "Anmeldung & Sicherheit", link: "/sicherheit" },
        ],
      },
      {
        text: "Funktionen",
        items: [
          { text: "SRF und ORF über HLS", link: "/hls" },
          { text: "Lokaler Filmlisten-Index", link: "/filmliste" },
          { text: "Benachrichtigungen", link: "/benachrichtigungen" },
          { text: "Post-Processing-Skripte", link: "/post-processing" },
          { text: "Rulesets & Shows", link: "/rulesets" },
        ],
      },
      {
        text: "Referenz",
        items: [
          { text: "API-Endpunkte", link: "/api" },
          { text: "Entwicklung", link: "/entwicklung" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "Diese Seite auf GitHub bearbeiten",
    },
    search: {
      provider: "local",
      options: {
        translations: {
          button: { buttonText: "Suchen", buttonAriaLabel: "Suchen" },
          modal: {
            noResultsText: "Keine Ergebnisse für",
            resetButtonTitle: "Suche zurücksetzen",
            footer: {
              selectText: "auswählen",
              navigateText: "navigieren",
              closeText: "schließen",
            },
          },
        },
      },
    },
    footer: {
      message: "Veröffentlicht unter der MIT-Lizenz.",
      copyright: "RundfunkArr basiert auf PCJones/MediathekArr.",
    },
    outline: { label: "Auf dieser Seite", level: [2, 3] },
    docFooter: { prev: "Vorherige Seite", next: "Nächste Seite" },
    lastUpdated: { text: "Zuletzt aktualisiert" },
    darkModeSwitchLabel: "Darstellung",
    lightModeSwitchTitle: "Zum hellen Design wechseln",
    darkModeSwitchTitle: "Zum dunklen Design wechseln",
    sidebarMenuLabel: "Menü",
    returnToTopLabel: "Nach oben",
    langMenuLabel: "Sprache",
    notFound: {
      title: "Seite nicht gefunden",
      quote: "Diese Seite gibt es nicht oder nicht mehr.",
      linkText: "Zur Startseite",
    },
  },
});
