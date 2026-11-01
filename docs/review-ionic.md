# Revisão de código: branch `ionic` (PWA → Ionic + Capacitor)

Branch de trabalho: `review/ionic`, criada a partir de `origin/ionic` (`acb2f97`).
Escopo: `git diff origin/master...origin/ionic` (197 arquivos), com foco nas
prioridades pedidas: áudio, download/armazenamento, serviços nativos, telas
Ionic e configuração nativa.

## Resumo

- **O áudio na web/PWA não regrediu.** O `web-audio-engine.ts` é o
  `audio.service.ts` da master, com só duas mudanças: virou uma classe
  `AudioEngine` sem `@Injectable` e lê o arquivo baixado por
  `downloader.localUrl()` em vez de chamar `db.get('files', …)` direto.
  As duas partes obrigatórias da skill `gapless-audio-lockscreen` continuam
  presentes e idênticas:
  1. o próximo capítulo real começa a tocar no segundo `<audio>` com
     `muted = true`, `PRIME_REMAINING_S = 2.5` s antes do fim, com um
     `setTimeout` de reserva (`schedulePrimeTimer`) para quando o
     `timeupdate` é estrangulado;
  2. a troca acontece ~0,35 s antes do `ended` (`maybeAdvanceIfStuckAtEnd`,
     chamado a cada `timeupdate`).

  Também continuam iguais a retomada síncrona de pausas espúrias e o
  `audioSession.type = 'playback'`. Comparei com `diff` contra o arquivo da
  master: sobram só esses dois trechos.
- **Os maiores riscos estão no caminho nativo**, que é código novo e não roda
  em nenhum teste de ponta a ponta: URLs com espaço no iOS < 17, cálculo de
  espaço livre que mede a coisa errada, arquivos parciais que ficam no disco e
  backup em nuvem de ~1,3 GB de MP3.
- As telas reescritas em Ionic mantêm todas as ações da master (comparei
  todos os `(click)` e chaves de tradução de home/plans/settings). As
  mudanças de comportamento que encontrei parecem intencionais ou são
  pequenas (lista abaixo).
- **5 bugs corrigidos** (1 alto, 4 médios), um commit por bug. Também
  adicionei testes para as duas correções que dá para testar em JS.

## Build e testes

| Etapa | Antes das correções | Depois das correções |
|---|---|---|
| `npm ci` | ok (exit 0) | ok (exit 0) |
| `npm run build` | ok, initial total 920.17 kB (211.11 kB transferidos) | ok, initial total 920.49 kB (211.19 kB) |
| `npm test` (`ng test --watch=false`, Vitest) | 12 arquivos, **39/39** passando | 14 arquivos, **44/44** passando |

Não havia Android SDK nem Xcode no ambiente, então **os projetos `android/` e
`ios/` não foram compilados**. Os XMLs novos do Android só passaram por uma
checagem de sintaxe.

## Tabela de achados

Gravidade: **A** = alta, **M** = média, **B** = baixa. Os números de linha se
referem ao estado atual da branch `review/ionic`.

### Bugs reais

| # | Arquivo:linha | Problema | Cenário que causa a falha | Grav. | Status |
|---|---|---|---|---|---|
| 1 | `src/app/services/native-audio-engine.ts:281`, `src/app/storage/audio-storage.ts:188` | A URL do capítulo tem um espaço literal (`…/GN/GN 1.mp3`, `bible.service.ts:67`) e era passada crua para o plugin de playlist e para `FileTransfer`. Os dois usam `URL(string:)` no iOS, que devolve `nil` para espaço não codificado até o iOS 16. | iPhone com iOS 15/16 (o deployment target é 15.0): todo capítulo que ainda não foi baixado some da fila sem nenhum aviso (`AudioTrack` volta `nil`) e todo download falha. A Bíblia praticamente não toca nem baixa. No iOS 17+ o `URL(string:)` codifica sozinho, por isso não aparece em aparelhos novos. | **A** | **Corrigido** (`d30ddd3`) |
| 2 | `src/app/services/audio-downloader.service.ts:157-171` | `ensureFreeDiskSpace()` chamava `removeOldest(3)` em loop enquanto `isSafe()` desse falso, sem verificar se algo tinha sido removido. | Com menos de 20 MB livres que **não** são ocupados por capítulos (ou já sem nenhum capítulo), o loop roda para sempre com um sleep de 100 ms, e todo download pendurado nele trava ("baixando…" eterno). No nativo é mais fácil acontecer: a estimativa é a cota do WebView, que não inclui os MP3 do Filesystem. Ele primeiro apagaria **todos** os capítulos baixados e depois travaria. | **M** | **Corrigido** (`6c42384`) |
| 3 | `src/app/storage/audio-storage.ts:173-203`, `:150-155` | O download nativo grava em `<id>.mp3.part` e renomeia ao terminar, mas o `.part` nunca era apagado. | Queda de rede, erro HTTP ou disco cheio no meio do download, ou o app fechado pelo SO durante o download da Bíblia inteira: arquivos truncados ficam no armazenamento privado ocupando espaço. Eles não entram no tamanho mostrado em Configurações. | **M** | **Corrigido** (`e472d68`): apaga em caso de falha e limpa os que sobraram ao montar o índice |
| 4 | `src/app/storage/audio-storage.ts:126-138` | No iOS, `Directory.Data` é a pasta `Documents/`, que entra no backup do iCloud/iTunes. | Usuário baixa a Bíblia inteira: ~1,3 GB de MP3 que podem ser baixados de novo vão para o backup do iCloud e consomem a cota dele. Isso também viola as iOS Data Storage Guidelines (App Review 2.23), um motivo comum de rejeição. | **M** | **Corrigido** (`6b4985b`): `Directory.LibraryNoCloud` no iOS, Android continua igual |
| 5 | `android/app/src/main/AndroidManifest.xml:4` | `allowBackup="true"` sem regras, e os capítulos ficam em `files/audios`. | O Auto Backup tem limite de 25 MB por app. Passando disso, o Android **não faz backup de nada** do app, nem do IndexedDB/localStorage do WebView com o progresso dos planos. Quem não fez login perde o progresso ao trocar de celular. | **M** | **Corrigido** (`98f3418`): `backup_rules.xml` + `data_extraction_rules.xml` excluem `files/audios` só do backup em nuvem |
| 6 | `src/app/storage/my-db.ts:254-265`, usado em `audio-downloader.service.ts:157`, `pages/settings/settings.ts:174`, `pages/home/home.html:38` | `AvailableSpace` usa `navigator.storage.estimate()`, que no nativo mede a cota do WebView e não o disco onde ficam os MP3. | (a) Aparelho com disco quase cheio: o app não percebe e cada capítulo falha no `FileTransfer`. (b) Configurações mostra um "espaço disponível" que não é o do aparelho. (c) O botão "baixar Bíblia inteira" só aparece com `availableMB > 1500`; se a cota do WebView for menor (ou `estimate` não existir, que vira 150 MB), o botão some mesmo com espaço de sobra. | **M** | **Pendente**: precisa de um plugin para espaço livre real (por exemplo `@capacitor/device` `realDiskFree`) e de uma decisão sobre o limite no nativo |
| 7 | `ios/App/App/Info.plist:24`; faltam `android/app/google-services.json` e `ios/App/App/GoogleService-Info.plist` | Login com Google nativo ainda não está configurado (placeholder `REPLACE_WITH_REVERSED_CLIENT_ID`, arquivos do Firebase ausentes). O README já lista isso como pendência. | Tocar em "Entrar com Google" no app nativo falha (no iOS, o retorno para o app não volta; no Android, o plugin não acha o client id). O erro é engolido em `settings.ts:140`, então o usuário não vê nada acontecer. | **A** para o lançamento (configuração, não código) | **Pendente**: precisa das credenciais do projeto Firebase |
| 8 | `android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java:24` | O teste do template espera o pacote `com.getcapacitor.app`, mas o app id agora é `live.nlabs.biblia`. | `./gradlew connectedAndroidTest` falha sempre. | B | Pendente (trivial) |
| 9 | `src/app/services/notifications.service.ts:59-60`, `:113` | No nativo, `subscribe()` grava `pushSubscribed=true` mesmo quando `scheduleNative` sai cedo porque não há versículos (`verses.length === 0`). | Bíblia ainda não carregada e sem rede para os versículos em inglês: o botão mostra "inscrito" e nenhum lembrete é agendado. | B | Pendente |
| 10 | `src/app/services/native-shell.service.ts:58-66` | Pede `POST_NOTIFICATIONS` no primeiro play no Android, com o argumento de que a notificação de mídia precisa dela. No Android 13+, notificações de sessão de mídia são isentas dessa permissão. | O usuário vê um pedido de permissão de notificação sem ter pedido o lembrete diário. Não quebra nada, mas é um pedido sem motivo claro. | B | Pendente (decisão de produto: pedir só ao ativar o lembrete?) |
| 11 | `src/app/services/native-audio-engine.ts:48`, `web-audio-engine.ts:82`, `pages/plans/plans.ts:139` | `trackEnded$` é um `BehaviorSubject` e a assinatura em Plans nunca é cancelada. Já era assim na master. | Se a página Plans for recriada com um plano aberto, o último capítulo terminado é reenviado e marcado como concluído. Com as abas do Ionic a página quase nunca é recriada, então o risco hoje é menor que na master. | B | Pendente (já existia na master) |
| 12 | `src/app/services/native-audio-engine.ts:121` | `setPlaylist()` no nativo só muda o estado em JS e não manda nada para a fila nativa. | Hoje ninguém chama. Se alguém passar a chamar `setPlaylist` e depois `play()`, o player nativo toca a fila antiga. | B | Pendente |
| 13 | `src/app/storage/audio-storage.ts:224-227` | `clear()` faz `rmdir` enquanto downloads podem estar em andamento. | "Apagar áudios" durante um download em massa: os `rename` seguintes falham (a pasta sumiu) e esses capítulos ficam marcados com erro. Não corrompe nada. | B | Pendente |

### Mudanças de comportamento nas telas (master → Ionic)

| # | Arquivo:linha | Observação | Grav. |
|---|---|---|---|
| 14 | `src/app/pages/plans/plans.ts:216-217` | Abrir um plano grava `lastUsedAt` e reordena `startedPlans` na hora, então a lista "Iniciados" muda de ordem enquanto o usuário está nela. Parece intencional (`985f8bf`), mas vale confirmar se a reordenação deveria esperar a volta para a lista. | B (UX) |
| 15 | `src/app/pages/home/home.ts:93-95` | `ionViewWillEnter` refaz a coloração por livro ao voltar para a aba Home. Se o usuário tinha um livro selecionado no picker (capítulos coloridos), as cores voltam para o nível de livro. | B (UX) |
| 16 | `src/app/pages/home/home.ts:143`, `:150` | Na web, o modal "instale o app" passou a ser não bloqueante, e o `confirm` de dados móveis (agora um `ion-alert`) pode abrir por cima dele. Na master o `window.confirm` era síncrono. | B (UX) |
| 17 | `src/app/pages/plans/plans.ts:30`, `_goToStoppedAt` | A paginação dos dias mudou. A master usava `mat-paginator` com 5 dias por página, seletor 5/10/20 e botões primeira/última. Agora são 7 dias fixos (uma semana) e só anterior/próxima, então quem está no dia 300 de um plano de 365 dias precisa avançar página por página. O salto para o dia onde o usuário parou continua existindo, e o cálculo novo (`floor((day - 1) / 7)`) está certo; o da master (`floor(day / 5)`) abria a página seguinte quando o dia era múltiplo de 5. | B (confirmar se foi intencional) |

Fora isso, as ações de cada tela da master continuam lá: home
(`fullDownload`, seleção no bible-picker, visualizador de texto, avisos de
Instagram e de instalação), plans (iniciar, abrir, retomar, excluir, marcar
dia, paginação, contagem de conclusões) e settings (idioma, apagar áudios,
login/logout, notificações, uso de armazenamento).

### Sugestões de estilo / limpeza (não são bugs)

- `package.json`: `firebase-admin` e `web-push` estão em `dependencies`, mas
  só servem aos scripts de servidor (cron de push). Ficariam melhor em
  `devDependencies` ou num pacote separado. Não entram no bundle.
- `src/app/services/audio-playlist.service.ts` não é usado em lugar nenhum
  (já era assim na master). Pode ser removido.
- `ios/App/App/Info.plist:69`: `UIRequiredDeviceCapabilities = armv7` vem do
  template. Funciona, mas `arm64` descreve melhor os aparelhos suportados.
  Também falta `ITSAppUsesNonExemptEncryption = false`, que evita a pergunta
  de criptografia a cada envio para o TestFlight.
- `src/app/storage/artwork.ts` continua em `Directory.Data`. É um PNG de
  poucos KB, então o backup não importa, mas mover para o mesmo diretório dos
  áudios deixaria tudo consistente.
- `NativeAudioEngine.onStatus` só registra `RMXSTATUS_ERROR` no console. Um
  capítulo que falha no meio da fila não chega à UI.

## O que foi corrigido (commits em `review/ionic`)

1. `d30ddd3`: **Encode the space in chapter URLs before handing them to
   native code.** Novo helper `nativeSafeUrl()` em `utils/platform.util.ts`
   (troca só espaço por `%20`, então URLs já codificadas não mudam), usado no
   `assetUrl` do plugin, na comparação de `flushLocalSwaps` e no
   `FileTransfer.downloadFile`. O caminho web não mudou. Testes:
   `platform.util.spec.ts` e um caso novo em `native-audio-engine.spec.ts`.
2. `6c42384`: **Stop ensureFreeDiskSpace from looping forever.** Sai do loop
   quando `removeOldest()` não remove nada. Teste novo:
   `audio-downloader.service.spec.ts`.
3. `e472d68`: **Delete partial .part files.** Faz `try/catch` em volta de
   `downloadFile` + `rename` e apaga o `.part` em caso de falha. Também apaga
   `.part` antigos ao montar o índice do diretório.
4. `6b4985b`: **Keep downloaded chapters out of iCloud backup on iOS.**
   `Directory.LibraryNoCloud` no iOS e `Directory.Data` no Android, que é a
   mesma pasta de antes. *Suposição:* o app iOS ainda não foi publicado (o
   `capacitor.config.ts` diz que o app id ainda vai ser confirmado antes do
   primeiro envio), então não há migração. Uma instalação de teste só
   precisa baixar de novo.
5. `98f3418`: **Exclude downloaded chapters from Android Auto Backup.**
   `res/xml/backup_rules.xml` (Android ≤ 11) e
   `res/xml/data_extraction_rules.xml` (Android 12+). A transferência direta
   entre aparelhos continua levando os áudios.

## O que ficou pendente (precisa de decisão ou de credenciais)

- **#6, espaço livre real no nativo:** escolher um plugin (por exemplo
  `@capacitor/device`) e definir o limite mínimo e a regra do botão
  "baixar tudo" no app.
- **#7, credenciais do Firebase para login nativo:** `google-services.json`,
  `GoogleService-Info.plist`, `REVERSED_CLIENT_ID` e o SHA-1 do app Android no
  console. Também vale mostrar uma mensagem quando o login falha, em vez de
  só `console.warn`.
- **#10, quando pedir permissão de notificação no Android.**
- #8, #9, #11, #12, #13 e as observações de UX #14 a #16: baixa gravidade,
  ficam listadas para quem for priorizar.

## O que só dá para verificar num aparelho real

Nada disto tem como ser exercitado em JS ou no CI deste ambiente:

1. **Avanço entre capítulos com a tela bloqueada na web/PWA**, no Android
   Chrome e no iOS Safari (PWA instalada), pelo alto-falante e por Bluetooth
   no carro. O código é igual ao da master, mas como o Ionic mudou o shell
   (ex.: `ion-router-outlet`, ciclo de vida das páginas), vale repetir o
   roteiro da skill `gapless-audio-lockscreen`.
2. **Avanço nativo** (Android Media3 / iOS AVQueuePlayer) com a tela
   bloqueada, em Bluetooth e Android Auto/CarPlay: confirmar que
   `RMXSTATUS_COMPLETED` dispara só quando o capítulo termina, e não num
   skip manual. Disso depende o progresso dos planos.
3. **Troca para o arquivo local durante a reprodução** (`flushLocalSwaps`): no
   iOS a fila é recriada e pode dar um pequeno soluço audível. Teste:
   começar a tocar online, colocar em modo avião e ver se a fila continua.
4. **iOS 15/16 com a correção #1:** confirmar que streaming e download
   funcionam. Testar também os arquivos locais em `Library/NoCloud`.
5. **Download em massa com o app em segundo plano / tela desligada** no
   Android e no iOS. No nativo não há watchdog: se o SO suspender o WebView
   no iOS, a barra pode ficar parada em "baixando".
6. **Disco quase cheio:** o que o usuário vê quando o `FileTransfer` falha
   por falta de espaço (relacionado ao #6).
7. **Notificações locais diárias:** horário (10h local), toque abrindo a Home
   com o app fechado (cold start), e o limite de 64 notificações pendentes
   no iOS (o app usa 30).
8. **Login Google nativo**, depois de configurar o #7, e a sincronização com
   o Firestore após o login.
9. **Auto Backup do Android:** `adb shell bmgr backupnow live.nlabs.biblia`
   com muitos capítulos baixados, para confirmar que os áudios ficam fora e
   que o progresso dos planos entra no backup.
10. **Botão voltar do Android** com modal aberto, fora da Home e na Home
    (deve minimizar o app sem parar o áudio).
