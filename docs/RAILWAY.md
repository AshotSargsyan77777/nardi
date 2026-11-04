# Railway-ում տեղադրում

Նախագիծը Railway-ում աշխատում է 4 ծառայությամբ՝ **Postgres**, **Redis**, **api**, **web**։
Երկու ծառայություններն էլ (api, web) կառուցվում են նույն ռեպոզիտորիայից՝ իրենց Dockerfile-ով։

## 1. Նախագծի ստեղծում

1. Railway → **New Project** → **Deploy from GitHub repo** → ընտրեք `nardi`։
   Ստեղծված ծառայությունը անվանափոխեք **`api`** (Settings → Service name)։
2. **+ New** → **Database** → **PostgreSQL**։
3. **+ New** → **Database** → **Redis**։
4. **+ New** → **GitHub Repo** → նորից `nardi`, անվանեք **`web`**։

> Ծառայությունների անունները պետք է լինեն հենց `api` և `web`, քանի որ ստորև փոփոխականները հղում են անում դրանց։

## 2. `api` ծառայություն

**Settings**
- *Root Directory*՝ թողեք դատարկ (ռեպոյի արմատ)։
- *Config-as-code → Railway Config File*՝ `apps/api/railway.toml`
  (Dockerfile, health-check `/api/health`)։ Միգրացիաները կատարվում են ամեն մեկնարկի ժամանակ։
- Եթե Config File դաշտը չեք գտնում, Variables-ում ավելացրեք `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`։
- *Networking → Generate Domain*՝ port **4000** (անհրաժեշտ է WebSocket-ի համար)։

**Variables** (Raw Editor-ում կարող եք ամբողջը միանգամից տեղադրել)

```
NODE_ENV=production
PORT=4000
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
JWT_ACCESS_SECRET=<openssl rand -base64 48>
WS_TICKET_SECRET=<openssl rand -base64 48, ուրիշ արժեք>
COOKIE_SECURE=true
TRUST_PROXY=2
PAYMENTS_PROVIDER=none
LEGAL_MONEY_MODE_APPROVED=false
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=<առնվազն 12 նիշ>
BOOTSTRAP_ADMIN_NICKNAME=Owner
# գաղտնաբառի վերականգնման նամակներ (ոչ պարտադիր, տես ներքևում)
RESEND_API_KEY=
MAIL_FROM=NARDI <no-reply@քո-դոմենը>
```

**Email (գաղտնաբառի վերականգնում).** Գրանցվիր resend.com-ում (անվճար՝ ամսական 3000 նամակ), ավելացրու
քո դոմենը (Domains → Add, DNS-ում դիր նրանց տված 3 գրառումը), ստեղծիր API Key ու դիր `RESEND_API_KEY`-ում։
`MAIL_FROM`-ում հասցեն պետք ա լինի այդ դոմենից։ Մինչ այդ «Մոռացե՞լ ես գաղտնաբառը»-ի նամակները չեն գնա,
բայց ադմինը խաղացողի էջում «🔑 Գաղտնաբառի հղում» կոճակով կարող ա ստեղծել հղում ու ուղարկել նրան։

- Գաղտնի բանալիները ստեղծեք տերմինալում՝ `openssl rand -base64 48` (յուրաքանչյուրի համար առանձին)։
- Յուրաքանչյուր deploy-ից առաջ ավտոմատ կատարվում են միգրացիաները, seed-ը և, եթե `BOOTSTRAP_ADMIN_*`
  փոփոխականները տրված են, ստեղծվում է SUPERADMIN (կրկնակի deploy-ի դեպքում ոչինչ չի փոխվում)։
  Առաջին մուտքից հետո կարող եք `BOOTSTRAP_ADMIN_PASSWORD`-ը ջնջել։

## 3. `web` ծառայություն

**Settings**
- *Root Directory*՝ դատարկ։
- *Railway Config File*՝ `apps/web/railway.toml` (կամ Variables-ում՝ `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile`)
- *Networking → Generate Domain*՝ port **3000**։ Սա կլինի կայքի հասցեն։

**Variables**

```
PORT=3000
API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000
NEXT_PUBLIC_WS_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
```

`API_INTERNAL_URL`-ը և `NEXT_PUBLIC_WS_URL`-ը ներառվում են կառուցման (build) ժամանակ․ դրանք փոխելուց
հետո `web`-ը պետք է նորից deploy անել։

## 4. Գործարկում և ստուգում

1. Deploy արեք նախ `api`-ն (Postgres-ը և Redis-ը պետք է արդեն աշխատեն), հետո `web`-ը։
2. Բացեք `https://<api-domain>/api/health` → `{"status":"ok",...}`։
3. Բացեք `https://<web-domain>` → գրանցվեք, խաղացեք «Անվճար խաղ»։
4. Մուտք գործեք `BOOTSTRAP_ADMIN_EMAIL`-ով → `/admin`։

## Ինչպես է աշխատում

- Բրաուզերը REST հարցումներն ուղարկում է `web` դոմենի `/api/*`-ին, իսկ Next.js-ը դրանք
  Railway-ի ներքին ցանցով փոխանցում է `api`-ին․ այդպես cookie-ները մնում են նույն դոմենում։
- WebSocket-ը միանում է անմիջապես `api`-ի հանրային դոմենին՝ միանգամյա տոմսով (cookie պետք չէ)։
- `TRUST_PROXY=2`՝ Railway-ի edge proxy + Next.js, որպեսզի rate-limit-ը տեսնի օգտատիրոջ իրական IP-ն։

## Հնարավոր խնդիրներ

| Ախտանիշ | Լուծում |
| --- | --- |
| `api`-ը չի մեկնարկում՝ «must be a strong secret» | `JWT_ACCESS_SECRET` / `WS_TICKET_SECRET` ≥ 32 նիշ, առանց `change-me` |
| Կայքը բացվում է, բայց մուտքը չի աշխատում | `web`-ի `API_INTERNAL_URL`-ը սխալ է կամ `api`-ի `PORT`-ը 4000 չէ → ուղղեք և redeploy `web` |
| Խաղը մնում է «Վերամիացում…» վիճակում | `NEXT_PUBLIC_WS_URL`-ը պետք է լինի `api`-ի հանրային դոմենը, իսկ `WEB_ORIGIN`-ը՝ `web`-ի ճշգրիտ հասցեն (https://…) |
| Pre-deploy-ը ձախողվում է միգրացիայի վրա | Postgres-ը պետք է լինի 15+ տարբերակ (Railway-ի լռելյայնը համապատասխանում է) |

Գնումներն անջատված են (`PAYMENTS_PROVIDER=none`), պլատֆորմն աշխատում է A ռեժիմով՝ առանց իրական գումարի
(մանրամասները՝ [LEGAL_MODEL.md](LEGAL_MODEL.md))։
