#!/usr/bin/env python3
"""Textos das lojas por idioma (Google Play e App Store Connect) via API.

Fonte dos textos: docs/play-store-listing.txt e docs/app-store-listing.txt.

Uso:
  python3 scripts/lojas.py conferir             # só local: confere limites de caracteres
  python3 scripts/lojas.py play ler             # lê o que está na Play (não grava)
  python3 scripts/lojas.py play diff            # compara a Play com o arquivo
  python3 scripts/lojas.py play enviar [--confirmar] [--idiomas en-US,ja-JP]
  python3 scripts/lojas.py apple ler
  python3 scripts/lojas.py apple diff
  python3 scripts/lojas.py apple enviar [--confirmar] [--idiomas en-US,ja]
  python3 scripts/lojas.py apple nova-versao 3.1.0 [--confirmar]
  python3 scripts/lojas.py apple publicar 3.1.0 [--confirmar]   # anexa o build VALID e envia à revisão

Sem --confirmar, "enviar" só mostra o que faria. Na Play, o envio é uma
edição única confirmada no fim (vale na hora). Na Apple:
  - nome e subtítulo ficam no appInfo editável (versão em preparação) e só
    aparecem na loja quando essa versão for aprovada;
  - descrição e palavras-chave vão para a versão em preparação
    (PREPARE_FOR_SUBMISSION); sem versão em preparação, o script avisa e pula;
  - o texto promocional também é gravado na versão publicada (muda na hora),
    mas só nos idiomas que ela já tem.

Credenciais (fora do repositório):
  PLAY_SA_JSON   conta de serviço  (padrão ~/android-keys-biblia-narrada/google-play-service-account.json)
  ASC_KEY_ID     (padrão K4Z4ZP7YGD, chave da API da equipe; a W739856C5C é de outro uso)
  ASC_KEY_P8     chave da API      (padrão ~/apple-carteira-pro/AuthKey_<ASC_KEY_ID>.p8)
  ASC_ISSUER_ID  (padrão: o issuer da equipe, o mesmo usado no CarteiraPro)
Requer: pip install pyjwt cryptography
"""
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PACOTE = "live.nlabs.biblia"
APPLE_APP_ID = "6832831597"

# Idioma do cabeçalho do app-store-listing.txt -> locale da Apple
APPLE_LOCALES = {
    "Português (Brasil)": "pt-BR",
    "English (U.S.)": "en-US",
    "Español (México)": "es-MX",
    "简体中文": "zh-Hans",
    "日本語": "ja",
}
APPLE_CAMPOS = {"Nome": "name", "Subtítulo": "subtitle", "Texto promocional": "promotionalText",
                "Palavras-chave": "keywords", "Descrição": "description",
                "Novidades (3.1.0)": "whatsNew"}
APPLE_LIMITES = {"name": 30, "subtitle": 30, "promotionalText": 170, "keywords": 100, "description": 4000, "whatsNew": 4000}
PLAY_CAMPOS = {"App name": "title", "Short description": "shortDescription", "Full description": "fullDescription"}
PLAY_LIMITES = {"title": 30, "shortDescription": 80, "fullDescription": 4000}


# ---------------------------------------------------------------- arquivos
def _secoes(caminho):
    """Divide o arquivo nas seções entre linhas '=====' -> [(cabeçalho, corpo)]."""
    linhas = caminho.read_text(encoding="utf-8").splitlines()
    marcas = [i for i, l in enumerate(linhas) if re.fullmatch(r"=+", l.strip())]
    out = []
    for a, b in zip(marcas[0::2], marcas[1::2]):
        fim = next((m for m in marcas if m > b), len(linhas))
        out.append((" ".join(linhas[a + 1:b]).strip(), linhas[b + 1:fim]))
    return out


def _campos(corpo, rotulos):
    campos, atual, buf = {}, None, []
    for l in corpo:
        r = l.strip().rstrip(":")
        if l.strip().endswith(":") and r in rotulos:
            if atual:
                campos[rotulos[atual]] = "\n".join(buf).strip()
            atual, buf = r, []
        elif atual:
            buf.append(l)
    if atual:
        campos[rotulos[atual]] = "\n".join(buf).strip()
    return campos


def textos_apple():
    out = {}
    for cab, corpo in _secoes(RAIZ / "docs/app-store-listing.txt"):
        nome = re.sub(r"^Idioma no App Store Connect:\s*", "", cab)
        nome = re.split(r"\s{2,}\(", nome)[0].strip()
        if nome not in APPLE_LOCALES:
            sys.exit(f"idioma sem locale da Apple: {nome!r} (acrescente em APPLE_LOCALES)")
        out[APPLE_LOCALES[nome]] = _campos(corpo, APPLE_CAMPOS)
    return out


def textos_play():
    out = {}
    for cab, corpo in _secoes(RAIZ / "docs/play-store-listing.txt"):
        m = re.search(r"—\s*([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?)\s*$", cab)
        if not m:
            sys.exit(f"cabeçalho sem código de idioma: {cab!r}")
        out[m.group(1)] = _campos(corpo, PLAY_CAMPOS)
    return out


def conferir(textos, limites, loja):
    ok = True
    for loc, c in textos.items():
        for campo, lim in limites.items():
            v = c.get(campo)
            if v is None:
                print(f"{loja} {loc}: falta {campo}"); ok = False
            elif len(v) > lim:
                print(f"{loja} {loc}: {campo} tem {len(v)} caracteres (limite {lim})"); ok = False
        kw = c.get("keywords")
        if kw and ", " in kw:
            print(f"{loja} {loc}: palavras-chave com espaço depois da vírgula"); ok = False
    print(f"{loja}: {len(textos)} idiomas, {'tudo dentro dos limites' if ok else 'há problemas'}")
    return ok


# ---------------------------------------------------------------- HTTP
def http(metodo, url, token, corpo=None, form=False):
    dados, cab = None, {"Authorization": f"Bearer {token}"} if token else {}
    if corpo is not None:
        if form:
            dados = urllib.parse.urlencode(corpo).encode()
            cab["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            dados = json.dumps(corpo).encode()
            cab["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=dados, headers=cab, method=metodo)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"{metodo} {url}\nHTTP {e.code}: {e.read().decode()[:2000]}")


def _jwt():
    try:
        import jwt  # pyjwt
    except ImportError:
        sys.exit("falta o pyjwt: pip install pyjwt cryptography")
    return jwt


def mostrar_diff(loc, campo, atual, novo):
    if (atual or "") == (novo or ""):
        return False
    a = (atual or "∅").replace("\n", " ⏎ ")
    n = (novo or "∅").replace("\n", " ⏎ ")
    print(f"  {loc} {campo}:\n    loja:    {a[:160]}\n    arquivo: {n[:160]}")
    return True


# ---------------------------------------------------------------- Google Play
class Play:
    BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACOTE}"

    def __init__(self):
        sa = json.loads(Path(os.path.expanduser(os.environ.get(
            "PLAY_SA_JSON", "~/android-keys-biblia-narrada/google-play-service-account.json"))).read_text())
        agora = int(time.time())
        asserc = _jwt().encode({"iss": sa["client_email"], "scope": "https://www.googleapis.com/auth/androidpublisher",
                                "aud": sa["token_uri"], "iat": agora, "exp": agora + 3600},
                               sa["private_key"], algorithm="RS256")
        self.token = http("POST", sa["token_uri"], None,
                          {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": asserc},
                          form=True)["access_token"]

    def abrir(self):
        return http("POST", f"{self.BASE}/edits", self.token, {})["id"]

    def listagens(self, edit):
        return {l["language"]: l for l in http("GET", f"{self.BASE}/edits/{edit}/listings", self.token).get("listings", [])}

    def descartar(self, edit):
        http("DELETE", f"{self.BASE}/edits/{edit}", self.token)

    def executar(self, acao, confirmar, idiomas):
        edit = self.abrir()
        try:
            loja = self.listagens(edit)
            if acao == "ler":
                for loc, l in sorted(loja.items()):
                    print(f"{loc}: {l.get('title')!r} | {l.get('shortDescription')!r}")
                return
            arq = {k: v for k, v in textos_play().items() if not idiomas or k in idiomas}
            if not conferir(arq, PLAY_LIMITES, "play") and acao == "enviar":
                sys.exit("corrija os limites antes de enviar")
            mudar = []
            for loc, c in arq.items():
                atual = loja.get(loc, {})
                if not atual:
                    print(f"  {loc}: idioma novo na Play")
                if any([mostrar_diff(loc, k, atual.get(k), c.get(k)) for k in PLAY_LIMITES]) or not atual:
                    mudar.append(loc)
            extra = sorted(set(loja) - set(textos_play()))
            if extra:
                print(f"  na Play mas não no arquivo (o script não mexe): {', '.join(extra)}")
            print(f"{len(mudar)} idioma(s) a gravar: {', '.join(mudar) or 'nenhum'}")
            if acao != "enviar" or not mudar:
                return
            if not confirmar:
                print("simulação: rode de novo com --confirmar para gravar"); return
            for loc in mudar:
                c = arq[loc]
                http("PUT", f"{self.BASE}/edits/{edit}/listings/{loc}", self.token,
                     {"language": loc, **{k: c[k] for k in PLAY_LIMITES}})
                print(f"  gravado {loc}")
            http("POST", f"{self.BASE}/edits/{edit}:commit", self.token, {})
            edit = None
            print("edição confirmada na Play")
        finally:
            if edit:
                self.descartar(edit)


# ---------------------------------------------------------------- App Store Connect
class Apple:
    BASE = "https://api.appstoreconnect.apple.com/v1"
    EDITAVEIS = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "WAITING_FOR_REVIEW"}

    def __init__(self):
        emissor = os.environ.get("ASC_ISSUER_ID", "860e526d-f41f-4cf0-b0d6-9ecaf5febb2f")
        chave_id = os.environ.get("ASC_KEY_ID", "K4Z4ZP7YGD")
        p8 = Path(os.path.expanduser(os.environ.get("ASC_KEY_P8", f"~/apple-carteira-pro/AuthKey_{chave_id}.p8"))).read_text()
        agora = int(time.time())
        self.token = _jwt().encode({"iss": emissor, "iat": agora, "exp": agora + 1200, "aud": "appstoreconnect-v1"},
                                   p8, algorithm="ES256", headers={"kid": chave_id, "typ": "JWT"})

    def get(self, caminho):
        return http("GET", f"{self.BASE}{caminho}", self.token)

    def estado(self):
        infos = self.get(f"/apps/{APPLE_APP_ID}/appInfos")["data"]
        versoes = self.get(f"/apps/{APPLE_APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10")["data"]
        def est(x): return x["attributes"].get("appStoreState") or x["attributes"].get("state")
        info_edit = next((i for i in infos if est(i) in self.EDITAVEIS), None)
        info_viva = next((i for i in infos if i is not info_edit), None)
        v_edit = next((v for v in versoes if est(v) in self.EDITAVEIS), None)
        v_viva = next((v for v in versoes if est(v) == "READY_FOR_SALE"), None)
        return info_edit, info_viva, v_edit, v_viva

    def locs(self, tipo, obj):
        if not obj:
            return {}
        rel = "appInfoLocalizations" if tipo == "appInfos" else "appStoreVersionLocalizations"
        return {l["attributes"]["locale"]: l for l in self.get(f"/{tipo}/{obj['id']}/{rel}?limit=50")["data"]}

    def nova_versao(self, versao, confirmar):
        _, _, v_edit, _ = self.estado()
        if v_edit:
            sys.exit(f"já existe versão editável: {v_edit['attributes'].get('versionString')}")
        corpo = {"data": {"type": "appStoreVersions", "attributes": {"platform": "IOS", "versionString": versao},
                          "relationships": {"app": {"data": {"type": "apps", "id": APPLE_APP_ID}}}}}
        if not confirmar:
            print(f"simulação: criaria a versão {versao}; rode com --confirmar"); return
        r = http("POST", f"{self.BASE}/appStoreVersions", self.token, corpo)
        print(f"versão {versao} criada: {r['data']['id']}")

    def publicar(self, versao, confirmar):
        """Anexa o build VALID mais novo da versão, liga a publicação automática e envia à revisão."""
        rel = lambda t, i: {"data": {"type": t, "id": i}}
        pre = self.get(f"/preReleaseVersions?filter[app]={APPLE_APP_ID}&filter[version]={versao}")["data"]
        if not pre:
            sys.exit(f"nenhum build {versao} na App Store Connect ainda")
        builds = [b for b in self.get(f"/preReleaseVersions/{pre[0]['id']}/builds?limit=50")["data"]
                  if b["attributes"]["processingState"] == "VALID"]
        if not builds:
            sys.exit(f"build {versao} ainda processando (nenhum VALID)")
        build = max(builds, key=lambda b: int(b["attributes"]["version"]))
        v = self.get(f"/apps/{APPLE_APP_ID}/appStoreVersions?filter[platform]=IOS&filter[versionString]={versao}")["data"]
        if not v:
            sys.exit(f"sem a versão {versao} (use nova-versao)")
        v = v[0]
        print(f"versão {versao} ({v['attributes']['appStoreState']}), build {build['attributes']['version']}")
        if not confirmar:
            print("simulação: rode com --confirmar para anexar e enviar à revisão"); return
        http("PATCH", f"{self.BASE}/appStoreVersions/{v['id']}", self.token,
             {"data": {"type": "appStoreVersions", "id": v["id"], "attributes": {"releaseType": "AFTER_APPROVAL"}}})
        http("PATCH", f"{self.BASE}/appStoreVersions/{v['id']}/relationships/build", self.token, rel("builds", build["id"]))
        print("build anexado, publicação automática depois da aprovação")
        sub = self.get(f"/reviewSubmissions?filter[app]={APPLE_APP_ID}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW")["data"]
        sub = sub[0] if sub else http("POST", f"{self.BASE}/reviewSubmissions", self.token,
            {"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"}, "relationships": {"app": rel("apps", APPLE_APP_ID)}}})["data"]
        itens = self.get(f"/reviewSubmissions/{sub['id']}/items?include=appStoreVersion")["data"]
        if not any(i.get("relationships", {}).get("appStoreVersion", {}).get("data", {}) and
                   i["relationships"]["appStoreVersion"]["data"]["id"] == v["id"] for i in itens):
            http("POST", f"{self.BASE}/reviewSubmissionItems", self.token,
                 {"data": {"type": "reviewSubmissionItems", "relationships": {
                     "reviewSubmission": rel("reviewSubmissions", sub["id"]), "appStoreVersion": rel("appStoreVersions", v["id"])}}})
        r = http("PATCH", f"{self.BASE}/reviewSubmissions/{sub['id']}", self.token,
                 {"data": {"type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})["data"]
        print(f"envio {sub['id']}: {r['attributes']['state']}")

    def executar(self, acao, confirmar, idiomas):
        info_edit, info_viva, v_edit, v_viva = self.estado()
        def rot(x): return f"{x['id']} ({x['attributes'].get('appStoreState') or x['attributes'].get('state')}" + \
            (f", {x['attributes'].get('versionString')}" if 'versionString' in x['attributes'] else "") + ")" if x else "—"
        print(f"appInfo editável: {rot(info_edit)} | appInfo publicado: {rot(info_viva)}")
        print(f"versão editável: {rot(v_edit)} | versão publicada: {rot(v_viva)}")
        li_edit, li_viva = self.locs("appInfos", info_edit), self.locs("appInfos", info_viva)
        lv_edit, lv_viva = self.locs("appStoreVersions", v_edit), self.locs("appStoreVersions", v_viva)
        if acao == "ler":
            for loc in sorted(set(li_viva) | set(li_edit) | set(lv_viva) | set(lv_edit)):
                a = (li_edit.get(loc) or li_viva.get(loc) or {}).get("attributes", {})
                print(f"{loc}: {a.get('name')!r} | {a.get('subtitle')!r}"
                      f" | versão publicada: {'sim' if loc in lv_viva else 'não'}, em preparação: {'sim' if loc in lv_edit else 'não'}")
            return
        arq = {k: v for k, v in textos_apple().items() if not idiomas or k in idiomas}
        if not conferir(arq, APPLE_LIMITES, "apple") and acao == "enviar":
            sys.exit("corrija os limites antes de enviar")
        plano = []  # (descrição, método, url, corpo)
        for loc, c in arq.items():
            # nome e subtítulo
            alvo = li_edit if info_edit else {}
            atual = (li_edit.get(loc) or li_viva.get(loc) or {}).get("attributes", {})
            if any([mostrar_diff(loc, k, atual.get(k), c[k]) for k in ("name", "subtitle")]):
                if not info_edit:
                    print(f"  {loc}: nome/subtítulo diferentes, mas não há appInfo editável (crie uma versão nova)")
                elif loc in alvo:
                    plano.append((f"{loc} nome/subtítulo", "PATCH", f"/appInfoLocalizations/{alvo[loc]['id']}",
                                  {"data": {"type": "appInfoLocalizations", "id": alvo[loc]["id"],
                                            "attributes": {"name": c["name"], "subtitle": c["subtitle"]}}}))
                else:
                    plano.append((f"{loc} nome/subtítulo (idioma novo)", "POST", "/appInfoLocalizations",
                                  {"data": {"type": "appInfoLocalizations",
                                            "attributes": {"locale": loc, "name": c["name"], "subtitle": c["subtitle"]},
                                            "relationships": {"appInfo": {"data": {"type": "appInfos", "id": info_edit["id"]}}}}}))
            # descrição, palavras-chave, promocional na versão em preparação
            campos_v = ("description", "keywords", "promotionalText", "whatsNew")
            atual_v = (lv_edit.get(loc) or lv_viva.get(loc) or {}).get("attributes", {})
            if any([mostrar_diff(loc, k, atual_v.get(k), c[k]) for k in campos_v]) or (v_edit and loc not in lv_edit):
                attrs = {k: c[k] for k in campos_v}
                if not v_edit:
                    print(f"  {loc}: descrição/palavras-chave só mudam numa versão em preparação (não há)")
                elif loc in lv_edit:
                    plano.append((f"{loc} textos da versão {v_edit['attributes']['versionString']}", "PATCH",
                                  f"/appStoreVersionLocalizations/{lv_edit[loc]['id']}",
                                  {"data": {"type": "appStoreVersionLocalizations", "id": lv_edit[loc]["id"], "attributes": attrs}}))
                else:
                    plano.append((f"{loc} textos da versão {v_edit['attributes']['versionString']} (idioma novo)", "POST",
                                  "/appStoreVersionLocalizations",
                                  {"data": {"type": "appStoreVersionLocalizations", "attributes": {"locale": loc, **attrs},
                                            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": v_edit["id"]}}}}}))
            # promocional na versão publicada (vale na hora)
            if loc in lv_viva and lv_viva[loc]["attributes"].get("promotionalText") != c["promotionalText"]:
                plano.append((f"{loc} texto promocional da versão publicada", "PATCH",
                              f"/appStoreVersionLocalizations/{lv_viva[loc]['id']}",
                              {"data": {"type": "appStoreVersionLocalizations", "id": lv_viva[loc]["id"],
                                        "attributes": {"promotionalText": c["promotionalText"]}}}))
        print(f"{len(plano)} gravação(ões) planejada(s):")
        for d, m, u, _ in plano:
            print(f"  {m} {u}  ← {d}")
        if acao != "enviar" or not plano:
            return
        if not confirmar:
            print("simulação: rode de novo com --confirmar para gravar"); return
        for d, m, u, corpo in plano:
            http(m, f"{self.BASE}{u}", self.token, corpo)
            print(f"  feito: {d}")
            if d.endswith("nome/subtítulo (idioma novo)"):
                # a Apple cria junto a localização da versão: replanejar com o estado novo
                return self.executar(acao, confirmar, idiomas)


# ---------------------------------------------------------------- main
def main(args):
    confirmar, idiomas, pos, it = False, None, [], iter(args)
    for a in it:
        if a == "--confirmar":
            confirmar = True
        elif a == "--idiomas":
            idiomas = set(next(it, "").split(","))
        else:
            pos.append(a)
    if pos[:1] == ["conferir"]:
        a = conferir(textos_apple(), APPLE_LIMITES, "apple")
        p = conferir(textos_play(), PLAY_LIMITES, "play")
        sys.exit(0 if a and p else 1)
    if pos[:2] == ["apple", "publicar"] and len(pos) == 3:
        return Apple().publicar(pos[2], confirmar)
    if pos[:2] == ["apple", "nova-versao"] and len(pos) == 3:
        return Apple().nova_versao(pos[2], confirmar)
    if len(pos) != 2 or pos[0] not in ("play", "apple") or pos[1] not in ("ler", "diff", "enviar"):
        sys.exit(__doc__)
    (Play if pos[0] == "play" else Apple)().executar(pos[1], confirmar, idiomas)


if __name__ == "__main__":
    main(sys.argv[1:])
