# SRF und ORF über HLS

Aktiviere **HLS-Streams aktivieren** unter Einstellungen → Streaming. Mit **ORF-Suche aktivieren**
werden ORF-Treffer aus MediathekView einbezogen. Für die SRF-API trägst du Consumer Key und
Consumer Secret aus dem
[SRG-SSR-Entwicklerportal](https://developer.srgssr.ch/en/apis/srgssr-video) ein.

Diese Quellen stehen der Websuche und Newznab einschließlich RSS-Sync zur Verfügung. Die
vorhandenen Episodenregeln bestimmen weiterhin, welche Releases Sonarr erhält.

## Download

SRF-Videoreferenzen werden erst beim Download durch yt-dlp aufgelöst, einschließlich der
benötigten Stream-Tokens. Ein optionaler Proxy gilt für yt-dlp und Downloads, jedoch nicht für die
SRG-SSR-Metadaten-API.

Die MKV-Einstellung gilt auch für HLS: aktiviert ergibt MKV, deaktiviert MP4.

## Regionale Beschränkungen

Regionale Beschränkungen hängen vom Proxy-Standort und der Verfügbarkeit beim Sender ab. Viele
ORF-Sendungen sind nur in Österreich abrufbar. Andernfalls liefert ORF statt des Videos einen
kurzen Sperrhinweis; RundfunkArr bricht den Download dann mit dem Fehler „ORF-Geosperre“ ab.

## yt-dlp

Docker enthält eine feste yt-dlp-Version mit Prüfsummenprüfung. Native Installationen können einen
eigenen Programmpfad oder den ebenfalls geprüften automatischen Download nutzen.
