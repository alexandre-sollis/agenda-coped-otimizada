import {
    agendaRef,
    setDoc,
    onSnapshot
} from "./firebase.js";

/* As datas, a ordenação e o "próximo evento" ficam em agenda-utils.js
   (compartilhado com o modo TV). */
const U = window.AgendaUtil;

/* =====================================================
   ELEMENTOS
===================================================== */

const $ = (id) => document.getElementById(id);

const tbody = $("tbody");
const template = $("linha");
const totalEventos = $("totalEventos");
const eventosHoje = $("eventosHoje");
const textoBarra = $("textoBarra");
const statusSalvar = $("statusSalvar");

const alertaEvento = $("alertaEvento");
const tituloEvento = $("tituloEvento");
const horaEvento = $("horaEvento");
const contadorEvento = $("contadorEvento");

const btnAdicionarLinha = $("btnAdicionarLinha");
const btnRemoverLinha = $("btnRemoverLinha");
const btnBaixarExcel = $("btnBaixarExcel");
const btnImportarExcel = $("btnImportarExcel");
const inputImportarExcel = $("inputImportarExcel");

/* =====================================================
   CABEÇALHO FIXO (os cards ficam logo abaixo dele)
===================================================== */

function ajustarScrollFixo() {
    const header = document.querySelector("header");
    const dashboard = document.querySelector(".dashboard");
    if (header && dashboard) dashboard.style.top = header.offsetHeight + "px";
    ajustarAlturaTabela();
}

// A tabela ocupa todo o espaço entre os cards e a barra azul do rodapé
// (no celular, até 650px, a página rola normalmente e isso não se aplica).
function ajustarAlturaTabela() {
    const cont = document.querySelector(".table-container");
    const rodape = document.querySelector("footer");
    if (!cont || !rodape) return;

    if (window.innerWidth <= 650) {
        cont.style.height = "";
        return;
    }

    const topo = cont.getBoundingClientRect().top + window.scrollY;
    const base = window.innerHeight - rodape.offsetHeight;
    cont.style.height = Math.max(base - topo, 160) + "px";
}

ajustarScrollFixo();
window.addEventListener("load", ajustarScrollFixo);
window.addEventListener("resize", ajustarScrollFixo);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(ajustarScrollFixo);
if (window.ResizeObserver) {
    // acompanha qualquer mudança de altura do cabeçalho ou dos cards
    const ro = new ResizeObserver(ajustarScrollFixo);
    ro.observe(document.querySelector("header"));
    ro.observe(document.querySelector(".dashboard"));
}

/* =====================================================
   ESTADO
===================================================== */

const CAMPOS = ["inicio", "fim", "horario", "aviso", "periodo", "acao", "responsavel"];
const PERIODOS = ["manha", "tarde", "noite", "integral"];

let salvando = false;
let salvarNovamente = false;   // chegou edição nova enquanto já salvava
let timeoutSalvar = null;
let ultimaVersao = "";         // versão (canônica) da última agenda salva/desenhada
let remotoPendente = null;     // alteração de outra pessoa que chegou durante uma edição
let ultimoAviso = "";
let tentativasErro = 0;
let alertouErro = false;

function definirStatusSalvar(texto, tipo) {
    if (!statusSalvar) return;
    statusSalvar.textContent = texto;
    statusSalvar.className = "status-salvar" + (tipo ? " status-" + tipo : "");
}

/* =====================================================
   LEITURA / ESCRITA DA TABELA
===================================================== */

function lerLinha(tr) {
    const td = tr.cells;
    const item = {};
    CAMPOS.forEach((campo, i) => { item[campo] = td[i].textContent.trim(); });
    item.aviso = item.aviso || "15";
    return item;
}

function lerTabela() {
    return Array.from(tbody.rows, lerLinha);
}

// Forma "canônica" da agenda: mesma ordem de campos e mesmo tratamento
// para dados vindos da tela e do Firestore, para a comparação ser confiável.
function versaoDe(agenda) {
    return JSON.stringify(agenda.map((it) =>
        CAMPOS.map((c) => String(it[c] == null ? "" : it[c]).trim() || (c === "aviso" ? "15" : ""))
    ));
}

function criarLinha(item = {}, destino = tbody) {
    const tr = template.content.firstElementChild.cloneNode(true);
    const td = tr.cells;

    td[0].textContent = U.formatarDataCurta(item.inicio);
    td[1].textContent = U.formatarDataCurta(item.fim);
    td[2].textContent = item.horario || "";
    td[3].textContent = item.aviso || "15";
    td[4].textContent = item.periodo || "";
    td[5].textContent = item.acao || "";
    td[6].textContent = item.responsavel || "";

    destino.appendChild(tr);
    return tr;
}

/* Um único conjunto de ouvintes na tabela inteira (antes eram 4 por célula,
   recriados a cada atualização vinda do Firebase). */
tbody.addEventListener("input", agendarSalvar);

tbody.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "TD") {
        e.preventDefault();
        e.target.blur();
    }
});

tbody.addEventListener("focusout", (e) => {
    atualizarLinhas();
    monitorarEventos();

    // Se o foco foi para outra célula, ainda é a mesma edição.
    if (e.relatedTarget && tbody.contains(e.relatedTarget)) return;
    aplicarRemotoPendente();
});

/* =====================================================
   MARCAÇÕES (hoje / passado / período) E INDICADORES
   — uma única passada pelas linhas
===================================================== */

function atualizarLinhas() {
    const hoje = U.hojeZero();
    let ativos = 0;

    for (const tr of tbody.rows) {
        const td = tr.cells;
        const inicio = U.converterData(td[0].textContent);
        const fim = U.converterData(td[1].textContent);

        const emAndamento = !!(inicio && fim && hoje >= inicio && hoje <= fim);
        if (emAndamento) ativos++;

        tr.classList.toggle("evento-hoje", emAndamento);
        tr.classList.toggle("evento-passado", !!(fim && fim < hoje));

        const periodos = U.classesPeriodo(td[4].textContent);
        PERIODOS.forEach((p) => tr.classList.toggle("periodo-" + p, periodos.includes(p)));
    }

    totalEventos.textContent = tbody.rows.length;
    eventosHoje.textContent = ativos;
}

/* =====================================================
   ADICIONAR / REMOVER LINHA
===================================================== */

function adicionarLinha() {
    const linha = criarLinha();

    atualizarLinhas();
    monitorarEventos();
    agendarSalvar();

    linha.scrollIntoView({ behavior: "smooth", block: "center" });
    linha.cells[0].focus();

    // destaca a linha nova por um instante
    linha.style.outline = "3px solid #FFC107";
    linha.style.background = "#FFF59D";
    setTimeout(() => {
        linha.style.outline = "";
        linha.style.background = "";
    }, 1500);
}

function removerLinha() {
    const ultima = tbody.rows[tbody.rows.length - 1];
    if (!ultima) return;

    // Não há "desfazer": só pergunta se a linha tiver conteúdo.
    const resumo = lerLinha(ultima);
    if (resumo.acao || resumo.inicio) {
        const nome = resumo.acao || "(sem descrição)";
        if (!confirm(`Excluir o último evento da lista?\n\n${resumo.inicio}  ${nome}`)) return;
    }

    ultima.remove();
    atualizarLinhas();
    monitorarEventos();
    agendarSalvar();
}

btnAdicionarLinha.addEventListener("click", adicionarLinha);
btnRemoverLinha.addEventListener("click", removerLinha);

/* =====================================================
   EXCEL (a biblioteca só é baixada quando alguém usa)
===================================================== */

const URL_XLSX = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let promessaXLSX = null;

function carregarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);

    if (!promessaXLSX) {
        promessaXLSX = new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = URL_XLSX;
            s.onload = () => resolve(window.XLSX);
            s.onerror = () => {
                promessaXLSX = null;   // permite tentar de novo
                reject(new Error("Falha ao carregar a biblioteca de Excel."));
            };
            document.head.appendChild(s);
        });
    }
    return promessaXLSX;
}

// Começa a baixar assim que o mouse/dedo chega perto dos botões,
// para o clique já encontrar a biblioteca pronta.
[btnBaixarExcel, btnImportarExcel].forEach((b) => {
    b.addEventListener("pointerenter", () => carregarXLSX().catch(() => {}), { once: true });
    b.addEventListener("focus", () => carregarXLSX().catch(() => {}), { once: true });
});

async function baixarExcel() {
    try {
        const XLSX = await carregarXLSX();

        const linhas = lerTabela().map((item) => ({
            "Início": item.inicio,
            "Fim": item.fim,
            "Horário": item.horario,
            "Aviso (min)": item.aviso,
            "Período": item.periodo,
            "Ação": item.acao,
            "Responsável": item.responsavel
        }));

        const livro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(livro, XLSX.utils.json_to_sheet(linhas), "Agenda");
        XLSX.writeFile(livro, `agenda_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (erro) {
        console.error("Erro ao gerar Excel:", erro);
        alert("Não foi possível gerar o arquivo Excel. Verifique a conexão com a internet e tente de novo.");
    }
}

// pega o primeiro nome de coluna que existir na planilha (com ou sem acento)
function coluna(linha, ...nomes) {
    for (const nome of nomes) {
        if (linha[nome] != null && linha[nome] !== "") return String(linha[nome]).trim();
    }
    return "";
}

async function importarExcel(arquivo) {
    try {
        const XLSX = await carregarXLSX();
        const dados = new Uint8Array(await arquivo.arrayBuffer());
        const livro = XLSX.read(dados, { type: "array" });
        const linhas = XLSX.utils.sheet_to_json(livro.Sheets[livro.SheetNames[0]], { defval: "" });

        if (!linhas.length) {
            alert("A planilha importada está vazia.");
            return;
        }

        // A importação SUBSTITUI todos os eventos atuais.
        if (tbody.rows.length &&
            !confirm(`Importar ${linhas.length} evento(s) vai SUBSTITUIR os ${tbody.rows.length} evento(s) atuais da agenda.\n\nDeseja continuar?`)) {
            return;
        }

        const frag = document.createDocumentFragment();
        linhas.forEach((l) => criarLinha({
            inicio: coluna(l, "Início", "Inicio"),
            fim: coluna(l, "Fim"),
            horario: coluna(l, "Horário", "Horario"),
            aviso: coluna(l, "Aviso (min)", "Aviso") || "15",
            periodo: coluna(l, "Período", "Periodo"),
            acao: coluna(l, "Ação", "Acao"),
            responsavel: coluna(l, "Responsável", "Responsavel")
        }, frag));

        tbody.innerHTML = "";
        tbody.appendChild(frag);

        atualizarLinhas();
        monitorarEventos();
        agendarSalvar();
    } catch (erro) {
        console.error("Erro ao importar Excel:", erro);
        alert("Não foi possível importar o arquivo. Verifique se é uma planilha Excel válida.");
    }
}

btnBaixarExcel.addEventListener("click", baixarExcel);
btnImportarExcel.addEventListener("click", () => inputImportarExcel.click());
inputImportarExcel.addEventListener("change", (e) => {
    const arquivo = e.target.files[0];
    if (arquivo) importarExcel(arquivo);
    e.target.value = "";
});

/* =====================================================
   SALVAR
===================================================== */

function agendarSalvar() {
    definirStatusSalvar("Alterações pendentes…", "pendente");
    clearTimeout(timeoutSalvar);
    timeoutSalvar = setTimeout(() => {
        timeoutSalvar = null;      // (antes ficava preenchido para sempre e o aviso de "sair da página" aparecia mesmo sem nada pendente)
        salvarFirebase();
    }, 500);
}

async function salvarFirebase() {
    // Se já está salvando, roda de novo quando terminar (nada se perde).
    if (salvando) {
        salvarNovamente = true;
        return;
    }

    salvando = true;
    definirStatusSalvar("Salvando…", "salvando");

    try {
        const agenda = lerTabela();
        ultimaVersao = versaoDe(agenda);

        await setDoc(agendaRef, {
            agenda,
            atualizadoEm: new Date().toISOString()
        });

        tentativasErro = 0;
        alertouErro = false;
        remotoPendente = null;     // o que foi salvo agora vale mais que o que chegou durante a edição
        definirStatusSalvar("Salvo ✓", "salvo");
    } catch (erro) {
        console.error(erro);
        tentativasErro++;
        salvando = false;

        definirStatusSalvar("⚠ Erro ao salvar — tentando novamente…", "erro");

        // tenta de novo com espera crescente (até 15 s)
        setTimeout(salvarFirebase, Math.min(2000 * tentativasErro, 15000));

        // avisa uma única vez (antes o alerta repetia a cada tentativa)
        if (tentativasErro >= 4 && !alertouErro) {
            alertouErro = true;
            alert(
                "Não foi possível salvar as últimas alterações na agenda há vários minutos. " +
                "Verifique sua conexão com a internet. Se o problema continuar, avise o suporte " +
                "— pode ser um problema de permissão no Firebase."
            );
        }
        return;
    }

    salvando = false;

    if (salvarNovamente) {
        salvarNovamente = false;
        salvarFirebase();
    }
}

// Avisa antes de fechar/recarregar a aba se ainda houver algo sem salvar
window.addEventListener("beforeunload", (e) => {
    if (salvando || timeoutSalvar || tentativasErro > 0) {
        e.preventDefault();
        e.returnValue = "";
    }
});

/* =====================================================
   FIREBASE (tempo real)
===================================================== */

function editandoAgora() {
    return !!(timeoutSalvar || salvando ||
        (document.activeElement && tbody.contains(document.activeElement)));
}

function aplicarRemotoPendente() {
    if (!remotoPendente || timeoutSalvar || salvando) return;
    const agenda = remotoPendente;
    remotoPendente = null;
    ultimaVersao = versaoDe(agenda);
    desenharTabela(agenda);
}

onSnapshot(agendaRef, async (snapshot) => {

    if (!snapshot.exists()) {
        console.warn("Documento 'agenda/principal' não existe. Criando um novo vazio.");
        await setDoc(agendaRef, { agenda: [], atualizadoEm: new Date().toISOString() });
        return;
    }

    const agenda = snapshot.data().agenda || [];

    if (versaoDe(agenda) === ultimaVersao) return;   // eco do que acabamos de salvar

    // Alguém alterou a agenda enquanto esta pessoa está digitando: não redesenha
    // a tabela agora (isso apagaria o que ela está escrevendo). Aplica depois.
    if (editandoAgora()) {
        remotoPendente = agenda;
        return;
    }

    ultimaVersao = versaoDe(agenda);
    desenharTabela(agenda);

}, (erro) => {
    console.error("Erro ao sincronizar com o Firestore:", erro);
    definirStatusSalvar("⚠ Sem conexão com o banco de dados", "erro");

    if (erro.code === "permission-denied") {
        alert(
            "Sem permissão para acessar a agenda no Firebase. " +
            "As regras de segurança do Firestore podem ter mudado. " +
            "Avise o responsável técnico."
        );
    }
});

function desenharTabela(lista) {
    lista.forEach((it, i) => { it._i = i; });
    U.ordenar(lista, U.hojeZero());

    const frag = document.createDocumentFragment();
    lista.forEach((item) => criarLinha(item, frag));

    tbody.innerHTML = "";
    tbody.appendChild(frag);

    atualizarLinhas();
    monitorarEventos();
}

/* =====================================================
   PRÓXIMO EVENTO, BARRA DO TOPO E ALERTA
===================================================== */

function monitorarEventos() {
    tbody.querySelectorAll(".evento-urgente").forEach((tr) => tr.classList.remove("evento-urgente"));

    const itens = Array.from(tbody.rows, (tr) => {
        const item = lerLinha(tr);
        item.tr = tr;
        return item;
    });

    const proximo = U.proximoEvento(itens, new Date());

    if (!proximo) {
        textoBarra.textContent = "Nenhum evento programado.";
        return;
    }

    textoBarra.textContent = proximo.texto;

    if (proximo.temHora && proximo.ms <= 300000) {
        proximo.item.tr.classList.add("evento-urgente");
    }

    dispararAviso(proximo);
}

function dispararAviso(proximo) {
    if (!proximo.temHora) return;

    const aviso = parseInt(proximo.item.aviso, 10);
    const restante = Math.ceil(proximo.ms / 60000);
    if (restante !== aviso) return;

    const chave = proximo.item.acao + proximo.item.horario + proximo.quando.toDateString();
    if (chave === ultimoAviso) return;
    ultimoAviso = chave;

    tituloEvento.textContent = proximo.item.acao;
    horaEvento.textContent = "Início às " + proximo.item.horario;
    contadorEvento.textContent = "Faltam " + aviso + " minutos";
    alertaEvento.style.display = "flex";

    tocarSom();

    setTimeout(() => { alertaEvento.style.display = "none"; }, 15000);
}

function tocarSom() {
    // Atenção: o arquivo "alerta.mp3" precisa existir na mesma pasta do index.html.
    const audio = new Audio("alerta.mp3");
    audio.volume = 1;
    audio.play().catch(() => console.log("Som bloqueado pelo navegador (ou alerta.mp3 não encontrado)."));
    setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
    }, 3000);
}

setInterval(monitorarEventos, 5000);

/* =====================================================
   NOTÍCIAS G1 NO RODAPÉ
   (usa a mesma lista de palavras bloqueadas do modo TV)
===================================================== */

const enc = encodeURIComponent(U.RSS_G1);

function titulosDoXml(textoXml) {
    const xml = new DOMParser().parseFromString(textoXml, "text/xml");
    if (xml.querySelector("parsererror")) throw new Error("XML inválido ao interpretar o RSS.");
    return Array.from(xml.querySelectorAll("item > title"), (t) => t.textContent);
}

const FONTES_NOTICIAS = [
    {   // feita para converter RSS em JSON; a mais estável
        nome: "rss2json",
        async buscar() {
            const r = await fetch("https://api.rss2json.com/v1/api.json?rss_url=" + enc);
            if (!r.ok) throw new Error("status " + r.status);
            const d = await r.json();
            if (d.status !== "ok" || !Array.isArray(d.items)) throw new Error("resposta inválida");
            return d.items.map((i) => i.title);
        }
    },
    {
        nome: "allorigins",
        async buscar() {
            const r = await fetch("https://api.allorigins.win/raw?url=" + enc);
            if (!r.ok) throw new Error("status " + r.status);
            return titulosDoXml(await r.text());
        }
    },
    {
        nome: "corsproxy.io",
        async buscar() {
            const r = await fetch("https://corsproxy.io/?url=" + enc);
            if (!r.ok) throw new Error("status " + r.status);
            return titulosDoXml(await r.text());
        }
    }
];

async function carregarNoticiasG1() {
    for (const fonte of FONTES_NOTICIAS) {
        try {
            const manchetes = (await fonte.buscar())
                .map((t) => String(t || "").trim())
                .filter((t) => t && U.manchetePermitida(t))
                .slice(0, 8);

            if (manchetes.length) {
                $("avisos").textContent = manchetes.map((m) => `📰 ${m}`).join("     •     ");
                return;
            }
        } catch (erro) {
            console.log(`Falha ao carregar notícias via ${fonte.nome}:`, erro.message || erro);
        }
    }
    console.log("Não foi possível carregar notícias do G1. Mantendo o texto atual do rodapé.");
}

carregarNoticiasG1();
setInterval(carregarNoticiasG1, 10 * 60 * 1000);
