# Android / Play Store

O app mobile do entregador foi preparado com Capacitor.

## Arquivos principais

- `capacitor.config.ts`
- `android/`
- `package.json`

## Scripts

- `npm run build:web`
  - build web para publicar em `/entregador`
- `npm run build:android`
  - build mobile com caminhos locais para Android
- `npm run android:prepare`
  - gera o build mobile e sincroniza com a pasta `android`
- `npm run android:open`
  - abre o projeto Android no Android Studio

## Antes de testar no celular

O arquivo `.env` ainda esta com:

```env
REACT_APP_API_URL=http://localhost:4000
```

Para o app Android funcionar fora do seu computador, troque isso para a URL publica do seu servidor, por exemplo:

```env
REACT_APP_API_URL=https://seu-dominio.com
```

Depois rode:

```bash
npm run android:prepare
```

## Fluxo para gerar app Android

1. Ajuste `REACT_APP_API_URL` para sua API publica.
2. Rode `npm run android:prepare`.
3. Rode `npm run android:open`.
4. No Android Studio, espere o Gradle carregar.
5. Teste em emulador ou celular.
6. Gere o arquivo `AAB`:
   - `Build`
   - `Generate Signed Bundle / APK`
   - `Android App Bundle`

## Para publicar na Play Store

Voce vai precisar de:

- conta no Google Play Console
- icone do app
- nome final do app
- screenshots
- politica de privacidade
- arquivo `AAB` assinado

## Observacoes

- Se sua API usar HTTP em vez de HTTPS, o Android pode bloquear as requisicoes.
- O ideal para Play Store e usar HTTPS.
- Sempre que mudar o front, rode de novo `npm run android:prepare`.
