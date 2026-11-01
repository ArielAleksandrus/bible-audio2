# Testes de ponta a ponta (web/PWA)

Testes com [Playwright](https://playwright.dev) contra o **build de produção**
da versão web (a mesma que vai para a Vercel), num Chromium real com perfil de
celular (Pixel 7).

```bash
npm run test:e2e
```

O script faz `ng build` e depois `playwright test -c e2e/playwright.config.ts`.
O Playwright sobe sozinho um servidor estático (`e2e/serve.mjs`, sem
dependências, com o mesmo fallback de SPA da Vercel) em
`http://127.0.0.1:4300`.

Para rodar só um arquivo ou um teste, sem rebuildar:

```bash
npx playwright test -c e2e/playwright.config.ts plans
npx playwright test -c e2e/playwright.config.ts -g "reload"
npx playwright test -c e2e/playwright.config.ts --headed   # vendo o navegador
```

Na primeira vez numa máquina nova, instale o navegador do Playwright:

```bash
npx playwright install chromium
```

(No ambiente de nuvem do Claude Code o Chromium já vem instalado; não rode o
`install` lá.)

## Sem rede externa

Tudo roda offline (`fixtures.ts`, fixture `cdn` com `auto: true`):

- os JSONs das Bíblias (`/jsons/<lang>-<versão>.json` no CDN R2) são
  respondidos com uma Bíblia gerada: 66 livros com o número real de capítulos
  e um versículo curto por capítulo;
- todo MP3 de capítulo (`/audios/...`) recebe `fixtures/chapter.mp3`, um tom
  de 4 s (gerado com
  `ffmpeg -f lavfi -i "sine=frequency=440:duration=4" -ac 1 -ar 22050 -b:a 24k`);
- qualquer outra requisição externa (Google Analytics, Firebase/Firestore,
  fontes) é abortada. Os avisos de Firestore "offline" no console são
  esperados.

O service worker fica bloqueado (`serviceWorkers: 'block'`): requisições
feitas pelo SW não passam pela interceptação, e o cache offline da PWA não é
o que estes testes cobrem.

## O que é coberto

| Arquivo | Cenário |
|---|---|
| `bible.e2e.ts` | primeira abertura → escolher idioma → livro e capítulo → toca (Media Session em `playing`, título na tela de bloqueio); pausar/retomar; idioma e Bíblia persistem após recarregar, sem novo download |
| `plans.e2e.ts` | começar um plano → toca o dia 1 e **avança sozinho** para o próximo capítulo; plano iniciado e progresso persistem após recarregar e "Retomar" continua do capítulo certo; excluir devolve o plano para "Disponíveis" |
| `settings.e2e.ts` | capítulo tocado fica salvo no aparelho (Blob real no IndexedDB); "Limpar áudios" persiste após recarregar; trocar o idioma muda o app e persiste após recarregar |

## O que estes testes **não** cobrem

Não dá para reproduzir num navegador headless: tela bloqueada, app em segundo
plano, Bluetooth/carro, interrupções do sistema (ligação, outro app tocando)
nem as notificações nativas. O app nativo (Capacitor/Android/iOS) também fica
de fora: ele só é exercitado pelos testes unitários com plugins falsos.
