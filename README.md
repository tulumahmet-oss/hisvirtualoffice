# Gather Town Ofis Prototipi

## Yerel calistirma

1. Node.js 18 veya ustunu kurun.
2. `.env.example` dosyasini `.env` olarak kopyalayip Google OAuth bilgilerini doldurun.
3. `npm install` ve `npm start` komutlarini calistirin.
4. Uygulamayi `http://localhost:3000` adresinden acin.

## Vercel ve GitHub ile yayinlama

Uygulama, giris oturumlari, oyuncu varligi, oda kilitleri, sandalye rezervasyonlari ve Socket.IO yayinlari icin Redis gerektirir. Vercel'de Redis Marketplace entegrasyonu ekleyin ve olusturulan `REDIS_URL` ortam degiskenini Production, Preview ve Development ortamlarina baglayin.

Vercel Project Settings > Environment Variables bolumune sunlari ekleyin:

- `NODE_ENV=production`
- `OFFICE_PASSWORD`: ofis giris sifresi
- `SESSION_SECRET`: en az 32 karakterlik rastgele bir deger
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://<proje-adiniz>.vercel.app/auth/google/callback`
- `REDIS_URL`: Redis entegrasyonunun verdigi baglanti adresi
- `ROOM1_MEET_URL` ... `ROOM4_MEET_URL` ve `ROOM_CHAT_SPACE` (kullaniyorsaniz)

Google Cloud Console'da OAuth istemcisinin yetkili yonlendirme URI listesine `GOOGLE_REDIRECT_URI` ile ayni HTTPS adresini ekleyin. Uretim ve onizleme ortamlarinin farkli alan adlari varsa her bir callback adresini Google OAuth ayarlarina ve ilgili Vercel ortam degiskenlerine ekleyin.

Vercel'de GitHub deposunu proje olarak ice aktarip yukaridaki degiskenleri girdikten sonra her `main` push'u yeni bir dagitim baslatir. Vercel WebSocket destegi genel kullanima aciktir; baglantilar Function'in calisma suresi limitine ulasinca kapanabilir ve istemci otomatik yeniden baglanir. Bu durumda oyuncu yeniden katilir. Redis oturumlari ve oyun durumunu Function ornekleri arasinda paylasir.

Git baslangic kurulumu (PowerShell):

```powershell
git init -b main
git remote add origin https://github.com/tulumahmet-oss/hisvirtualoffice.git
git add .gitignore .env.example README.md api package.json package-lock.json public server.js vercel.json
git status --short
git commit -m "Add Vercel multiplayer deployment" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin main
```

`.env` ve `data/` yerel kalir; Git'e eklenmemelidir. GitHub kimlik dogrulamasinda Personal Access Token'i komut satirina veya depoya yazmayin; Git Credential Manager ya da GitHub CLI ile oturum acin.
