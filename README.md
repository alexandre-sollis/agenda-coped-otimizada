# Agenda Institucional — DRE Cáceres (versão otimizada)

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Página principal (agora leve: a logo é um arquivo, não vai mais embutida) |
| `agenda.css` | **Único** arquivo de estilos (junta o antigo `style.css` + `refino.css` + `tv-compat.css`, na mesma ordem) |
| `agenda-utils.js` | **Novo.** Datas, ordenação e "próximo evento", usados pela página e pela TV |
| `app.js` | Script da agenda: carrega, mostra, edita, adiciona e importa eventos |
| `tv.js` | Script do modo TV (só é usado quando a URL tem `?tv=1`) |
| `firebase.js` | Ligação com o Firebase/Firestore (projeto `drecac-3daaf`) — sem alterações |
| `agenda-config.js` | Onde você coloca a chave do Firebase — sem alterações |
| `logo.png` | Logo otimizada (300×162) |
| `favicon.png` | Ícone da aba (48×48) |

Os arquivos `style.css`, `refino.css` e `tv-compat.css` **não são mais usados** e podem ser apagados.

## Como abrir

1. Abra o `agenda-config.js` e coloque a sua chave no lugar de `COLE_SUA_CHAVE_AQUI`.
2. Sirva esta pasta como raiz do site. Por exemplo: `python3 -m http.server 8000`
   e abra `http://localhost:8000/index.html`.
3. Modo TV: `http://localhost:8000/index.html?tv=1`.

Abrir com dois cliques (`file://`) não funciona: o navegador bloqueia o Firebase e os módulos.

## Ao editar qualquer arquivo

Aumente a versão para o navegador não mostrar a cópia antiga. Está em **3 pontos, todos no `index.html`**:
`agenda.css?v=22`, `agenda-utils.js?v=22` e `var VERSAO = "22"` (esta já vale para `app.js` e `tv.js`).
Dica: localize `22` (entre aspas e depois de `v=`) e troque por `23`.

## Detalhes

- Os caminhos agora são relativos (`agenda-config.js`, `favicon.png`), então a pasta pode ficar
  na raiz do site ou em uma subpasta (ex.: `/agenda/`) sem mudar nada.
- A chave do Firebase é pública por natureza; quem protege os dados são as regras do Firestore.
- O som de aviso espera um arquivo `alerta.mp3` na mesma pasta (ele não veio nos arquivos enviados).
