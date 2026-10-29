# Anmeldung & Sicherheit

## Diagnose und Protokoll schützen

Diagnose, Verbindungstest und Protokoll sind durch einen eigenen Admin-Schlüssel geschützt. Ohne
gültige Konfiguration bleiben `/api/logs` und `/api/diagnostics` gesperrt.

1. Einen zufälligen Schlüssel erzeugen:

   ```bash
   openssl rand -hex 32
   ```

2. Als `DIAGNOSTICS_ADMIN_KEY` in der Serverumgebung setzen und den Server neu starten. Die
   mitgelieferte Compose-Datei übernimmt den Wert aus `.env`.
3. Auf **Diagnose & Protokoll** den Schlüssel eingeben.

Die Seite behält den Schlüssel nur im Arbeitsspeicher, bis sie gesperrt, verlassen oder neu
geladen wird. Auch der Textexport verlangt ihn. Direkte API-Aufrufe verwenden den Header
`X-RundfunkArr-Admin-Key`; der Schlüssel gehört nicht in die URL. Außerhalb eines
vertrauenswürdigen Netzes HTTPS verwenden.

Freigeschaltete Administratoren können interne Sonarr-/Radarr-Adressen testen, auch
Docker-Hostnamen und Loopback-Adressen. Weiterleitungen werden abgelehnt; der Admin-Schlüssel wird
nicht an die Zielanwendung gesendet. Dieser Schutz gilt nur für Diagnose und Protokoll, nicht für
die übrige Anwendung.

Bei aktivierter Anmeldung ist zusätzlich eine gültige Browser-Sitzung erforderlich. Direkte
schreibende API-Aufrufe benötigen außerdem einen passenden `Origin`-Header. Der
Integrationsschlüssel für Sonarr/Radarr ersetzt weder die Sitzung noch den Diagnose-Schlüssel.

## Optionale Anmeldung

Unter **Einstellungen → Allgemein → Sicherheit** lässt sich ein Anmeldeformular mit Benutzername
und Passwort aktivieren. Standardmäßig ist die Anmeldung aus, damit bestehende Installationen
unverändert starten. Neue Passwörter benötigen mindestens 12 Zeichen und werden ausschließlich als
gesalzener scrypt-Hash gespeichert.

Bei aktivierter Anmeldung gelten folgende Zugriffswege:

- **Browser:** Loginformular; die Sitzung läuft nach 12 Stunden ab, mit „30 Tage angemeldet
  bleiben“ nach 30 Tagen. Abmelden widerruft die Sitzung auf dem Server.
- **Sonarr/Radarr/Prowlarr:** den **Integrationsschlüssel** aus den Sicherheitseinstellungen als
  API-Key sowohl im Newznab-Indexer als auch im SABnzbd-Download-Client eintragen. Vorher
  beliebige Werte funktionieren dann nicht mehr. `apikey` als URL-Parameter und `X-Api-Key` als
  Header werden unterstützt.
- Der Integrationsschlüssel gilt nur für die SABnzbd-/Newznab-Schnittstellen, nicht für die
  Verwaltungs-API. NZB-Links aus authentifizierten Suchantworten erhalten eine Signatur für genau
  diese Datei, damit der Download ohne Browsercookie gelingt.
- Interne Adressen und Docker-Netze bleiben nutzbar. Es gibt keine automatische
  Anmeldeausnahme für lokale Adressen oder `X-Forwarded-For`.
- `/api/health` bleibt für Container-Healthchecks ohne Anmeldung erreichbar und liefert
  ausschließlich einen allgemeinen Status.

::: warning Integrationsschlüssel nach dem Aktivieren neu eintragen
Bei jedem Wechsel von deaktivierter zu aktivierter Anmeldung wird der Integrationsschlüssel
automatisch ersetzt, auch beim erneuten Aktivieren eines vorhandenen Kontos. Den neuen Wert
**nach dem Speichern** in den verbundenen Anwendungen eintragen; alte Schlüssel und NZB-Links
werden ungültig.
:::

Änderungen bei bereits aktivierter Anmeldung erfordern das aktuelle Passwort und melden andere
Sitzungen ab. Dabei bleibt der Integrationsschlüssel erhalten, sofern nicht ausdrücklich ein neuer
erzeugt wird. Das Abschalten öffnet Oberfläche und APIs wieder, daher vorher die Erreichbarkeit auf
ein vertrauenswürdiges Netz begrenzen.

Docker legt die Authentifizierungstabellen beim Start auch für vorhandene Datenbanken an. Bei
nativer Installation vor dem Start `npx prisma migrate deploy` oder den bereits verwendeten
`npx prisma db push`-Ablauf ausführen.

### Passwort vergessen

Auf dem Server mit Zugriff auf dieselbe Datenbank ausführen:

```bash
node scripts/reset-auth.mjs --confirm

# im Container
docker exec rundfunkarr node /app/scripts/reset-auth.mjs --confirm
```

Das deaktiviert die Anmeldung, löscht das Passwort, widerruft alle Sitzungen und ersetzt den
Integrationsschlüssel. Danach im vertrauenswürdigen Netz ein neues Konto konfigurieren. Ein
Neustart allein löscht keine Anmeldung.

## Reverse Proxy

Für Zugriff außerhalb eines vertrauenswürdigen Netzes HTTPS verwenden. Hinter einem Reverse Proxy
`AUTH_PUBLIC_URL` auf den öffentlichen Ursprung setzen, etwa `https://rundfunk.example.com` (ohne
Pfad). Das erlaubt die Prüfung von Browseranfragen und setzt bei HTTPS sichere Sitzungscookies.
`AUTH_COOKIE_SECURE=true` erzwingt sichere Cookies zusätzlich. Der Proxy muss den Hostnamen
weitergeben. Cookies sind HttpOnly und SameSite=Strict; Passwörter und Sitzungstoken werden nicht
im Browserspeicher abgelegt.

### Anmeldeversuche begrenzen

Für öffentlich erreichbare Installationen zusätzlich die Anmeldeversuche am Reverse Proxy pro
tatsächlicher Client-Adresse begrenzen. RundfunkArr reserviert für Passwortprüfungen ein festes
Zwei-Sekunden-Fenster; falsche Passwörter und abgewiesene Versuche verlängern es nicht. Diese
gemeinsame Begrenzung schützt die Rechenkapazität, verhindert aber keine gezielt getaktete
Blockierung neuer Anmeldungen. Bestehende Sitzungen bleiben dabei nutzbar.

Beispiel für [NGINX-Anfragelimits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html):
Die ersten beiden Direktiven gehören in den `http`-Kontext; den `location`-Block in den vorhandenen
HTTPS-Server integrieren und das Proxy-Ziel anpassen.

```nginx
map $uri $rundfunkarr_login_client {
    default "";
    ~^/api/auth/login/?$ $binary_remote_addr;
}
limit_req_zone $rundfunkarr_login_client zone=rundfunkarr_login:10m rate=5r/m;

location / {
    limit_req zone=rundfunkarr_login burst=5 nodelay;
    limit_req_status 429;
    proxy_set_header Host $http_host;
    proxy_pass http://rundfunkarr:6767;
}
```

Nur Login-Anfragen verbrauchen dieses Limit. Den RundfunkArr-Port von außen ausschließlich über
diesen Proxy erreichbar machen. Ist ein weiterer Proxy oder ein CDN vorgeschaltet, dessen feste
Adressen über
[`set_real_ip_from`](https://nginx.org/en/docs/http/ngx_http_realip_module.html#set_real_ip_from)
als vertrauenswürdig konfigurieren; vom Client gesetzte `X-Forwarded-For`-Werte dürfen keine neuen
Limit-Gruppen erzeugen.
