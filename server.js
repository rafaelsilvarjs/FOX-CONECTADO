const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 4000;
const TEMPO_REATRIBUICAO_MS = 5 * 60 * 1000;
const TEXTOS_PRONTOS_PATH = path.join(__dirname, "painel", "data", "textos-prontos.json");
const DATABASE_PATH = path.join(__dirname, "data", "foxlog-connect.db");
const LOGIN_FALLBACK_PATH = path.join(__dirname, "data", "login-fallback.json");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const GOOGLE_SHEET_ID = "1CSC17Trs7wDjC1zfQmmWSJIOe8Kr7TX9omLxMHd8q5k";
const GOOGLE_SHEET_GID = "0";
const GOOGLE_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=${GOOGLE_SHEET_GID}`;
const PLANILHA_CACHE_MS = 5 * 60 * 1000;
const LOGIN_SHEET_ID = "1OrJYqGGnXhEnp0Sq9WtDoBkagJmoxs7nda9CNEJE0eA";
const LOGIN_SHEET_NAME = "login";
const LOGIN_SHEET_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${LOGIN_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(LOGIN_SHEET_NAME)}`;
const LOGIN_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${LOGIN_SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(LOGIN_SHEET_NAME)}`;
const PERFORMANCE_SHEET_ID = "1p4w8hJcq7lqIMsB75h51SPe3zNcjSNjYVdR1KS9w8BA";
const PERFORMANCE_SHEET_GID = "0";
const PERFORMANCE_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${PERFORMANCE_SHEET_ID}/export?format=csv&gid=${PERFORMANCE_SHEET_GID}`;

const app = express();
app.use(cors());
app.use(express.json());

const painelBuildPath = path.join(__dirname, "painel", "build");
const entregadorBuildPath = path.join(__dirname, "painel", "entregador", "build");

app.use("/painel", express.static(painelBuildPath));
app.use("/entregador", express.static(entregadorBuildPath));

function enviarSpaIndex(res, buildPath) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(buildPath, "index.html"));
}

app.get("/", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>FoxLog Connect</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #02060b;
            color: #f5fbff;
            font-family: "Segoe UI", Arial, sans-serif;
          }
          main {
            width: min(92vw, 560px);
            padding: 32px;
            border-radius: 28px;
            background: linear-gradient(180deg, rgba(6, 12, 18, 0.88), rgba(8, 16, 24, 0.94));
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 26px 60px rgba(0, 0, 0, 0.42);
          }
          h1 {
            margin: 0 0 10px;
            font-size: 32px;
          }
          p {
            margin: 0 0 24px;
            color: #95abc1;
            line-height: 1.5;
          }
          .links {
            display: grid;
            gap: 14px;
          }
          a {
            display: block;
            padding: 16px 18px;
            border-radius: 16px;
            text-decoration: none;
            color: #ffffff;
            font-weight: 600;
            background: linear-gradient(135deg, #27d08c, #1fb9d8);
          }
        </style>
      </head>
      <body>
        <main>
          <h1>FoxLog Connect</h1>
          <p>Abra uma das interfaces abaixo para visualizar o painel de atendimento ou o aplicativo dos entregadores.</p>
          <div class="links">
            <a href="/painel">Abrir painel de atendimento</a>
            <a href="/entregador">Abrir aplicativo dos entregadores</a>
          </div>
        </main>
      </body>
    </html>
  `);
});

app.get(/^\/painel(?:\/.*)?$/, (_req, res) => {
  enviarSpaIndex(res, painelBuildPath);
});

app.get(/^\/entregador(?:\/.*)?$/, (_req, res) => {
  enviarSpaIndex(res, entregadorBuildPath);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let atendentes = [];
const REGIOES_SUPORTE = ["Sao Paulo", "Rio de Janeiro", "Campinas"];
const MENSAGEM_FINALIZACAO_PADRAO =
  "A Fox Log agradece e estamos aqui a qualquer momento para melhor atende-los.";
const TEXTOS_PRONTOS_PADRAO = [
  {
    label: "Em analise",
    text: "Ola! Estamos verificando sua solicitacao."
  },
  {
    label: "Confirmar nome",
    text: "Pode me confirmar seu nome completo, por favor?"
  },
  {
    label: "Acionar operacao",
    text: "Recebido. Vou acionar a operacao e retorno em seguida."
  },
  {
    label: "Em acompanhamento",
    text: "Seu caso foi encaminhado e seguimos acompanhando."
  }
];

const base = {
  "11111111111": { cpf: "11111111111", nome: "Carlos Silva", telefone: "(11) 98888-1111", regiao: "Sao Paulo", observacoes: "Atua na zona sul." },
  "22222222222": { cpf: "22222222222", nome: "Mariana Souza", telefone: "(21) 97777-2222", regiao: "Rio de Janeiro", observacoes: "Preferencia por atendimento rapido." },
  "33333333333": { cpf: "33333333333", nome: "Joao Pereira", telefone: "(19) 96666-3333", regiao: "Campinas", observacoes: "Entrega em periodo noturno." },
  "44444444444": { cpf: "44444444444", nome: "Fernanda Costa", telefone: "(11) 95555-4444", regiao: "Sao Paulo", observacoes: "Atende regiao oeste." },
  "55555555555": { cpf: "55555555555", nome: "Bruno Almeida", telefone: "(21) 94444-5555", regiao: "Rio de Janeiro", observacoes: "Disponivel aos fins de semana." },
  "66666666666": { cpf: "66666666666", nome: "Patricia Lima", telefone: "(19) 93333-6666", regiao: "Campinas", observacoes: "Usa veiculo utilitario." }
};

const fila = [];
const sockets = {};
const conversas = {};
const historicos = {};
const atendimentos = {};
const chatsAbertos = {};
const statusAtendentes = {};
const regioesAtendentes = {};
let textosProntos = sanitizarTextosProntos(TEXTOS_PRONTOS_PADRAO);
let cachePlanilha = {
  expiresAt: 0,
  rows: []
};
let cacheLogin = {
  expiresAt: 0,
  rows: []
};
let cachePerformance = {
  expiresAt: 0,
  rows: []
};
let db = null;
let supabase = null;
let storageMode = "sqlite";

const LOGIN_FALLBACK_PADRAO = [
  { email: "rafael@foxlog.com", nome: "Rafael", role: "admin", status: "admin", senha: "" },
  { email: "tiago@foxlog.com", nome: "Tiago", role: "atendente", status: "atendente", senha: "" },
  { email: "willian@foxlog.com", nome: "Willian", role: "atendente", status: "atendente", senha: "" },
  { email: "marcela@foxlog.com", nome: "Marcela", role: "atendente", status: "atendente", senha: "" },
  { email: "fernanda@foxlog.com", nome: "Fernanda", role: "atendente", status: "atendente", senha: "" },
  { email: "andre@foxlog.com", nome: "Andre", role: "operacao", status: "operacao", senha: "" },
  { email: "jeffersson@foxlog.com", nome: "Jeffersson", role: "atendente", status: "atendente", senha: "" },
  { email: "dantas@foxlog.com", nome: "Dantas", role: "atendente", status: "atendente", senha: "" }
];

function parseJsonField(valor, fallback) {
  if (valor === null || valor === undefined) return fallback;
  if (typeof valor === "string") {
    try {
      return JSON.parse(valor);
    } catch (_) {
      return fallback;
    }
  }
  return valor;
}

function mapearTicketPersistido(row) {
  return {
    id: String(row.id),
    cpf: row.cpf,
    iniciadoEm: row.iniciado_em,
    finalizadoEm: row.finalizado_em,
    motivo: row.motivo || "finalizado",
    atendenteAtual: parseJsonField(row.atendente_atual_json ?? row.atendente_atual, null),
    finalizadoPor: parseJsonField(row.finalizado_por_json ?? row.finalizado_por, null),
    mensagens: parseJsonField(row.mensagens_json ?? row.mensagens, []),
    eventos: parseJsonField(row.eventos_json ?? row.eventos, [])
  };
}

function inicializarBancoSqlite() {
  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  db = new DatabaseSync(DATABASE_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpf TEXT NOT NULL,
      iniciado_em TEXT,
      finalizado_em TEXT,
      motivo TEXT,
      atendente_atual_json TEXT,
      finalizado_por_json TEXT,
      mensagens_json TEXT,
      eventos_json TEXT
    );
  `);
}

async function inicializarPersistencia() {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { error } = await supabase.from("tickets").select("id", { head: true, count: "exact" });
    if (error) {
      throw new Error(`Nao foi possivel conectar ao Supabase: ${error.message}`);
    }

    storageMode = "supabase";
    return;
  }

  inicializarBancoSqlite();
  storageMode = "sqlite";
}

async function carregarHistoricosDoBanco() {
  if (storageMode === "supabase" && supabase) {
    const { data, error } = await supabase
      .from("tickets")
      .select("id, cpf, iniciado_em, finalizado_em, motivo, atendente_atual, finalizado_por, mensagens, eventos")
      .order("finalizado_em", { ascending: false, nullsFirst: false });

    if (error) {
      throw new Error(`Nao foi possivel carregar tickets do Supabase: ${error.message}`);
    }

    data.forEach((row) => {
      const ticket = mapearTicketPersistido(row);
      if (!historicos[ticket.cpf]) {
        historicos[ticket.cpf] = [];
      }
      historicos[ticket.cpf].push(ticket);
    });
    return;
  }

  if (!db) return;

  const rows = db
    .prepare(`
      SELECT id, cpf, iniciado_em, finalizado_em, motivo, atendente_atual_json, finalizado_por_json, mensagens_json, eventos_json
      FROM tickets
      ORDER BY id DESC
    `)
    .all();

  rows.forEach((row) => {
    if (!historicos[row.cpf]) {
      historicos[row.cpf] = [];
    }

    historicos[row.cpf].push(mapearTicketPersistido(row));
  });
}

async function inserirHistoricoNoBanco(historico) {
  if (storageMode === "supabase" && supabase) {
    const payload = {
      cpf: historico.cpf,
      iniciado_em: historico.iniciadoEm,
      finalizado_em: historico.finalizadoEm,
      motivo: historico.motivo,
      atendente_atual: historico.atendenteAtual || null,
      finalizado_por: historico.finalizadoPor || null,
      mensagens: historico.mensagens || [],
      eventos: historico.eventos || []
    };

    const { data, error } = await supabase
      .from("tickets")
      .insert(payload)
      .select("id, cpf, iniciado_em, finalizado_em, motivo, atendente_atual, finalizado_por, mensagens, eventos")
      .single();

    if (error) {
      throw new Error(`Nao foi possivel salvar ticket no Supabase: ${error.message}`);
    }

    return mapearTicketPersistido(data);
  }

  if (!db) return historico;

  const resultado = db
    .prepare(`
      INSERT INTO tickets (
        cpf, iniciado_em, finalizado_em, motivo, atendente_atual_json, finalizado_por_json, mensagens_json, eventos_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      historico.cpf,
      historico.iniciadoEm,
      historico.finalizadoEm,
      historico.motivo,
      JSON.stringify(historico.atendenteAtual || null),
      JSON.stringify(historico.finalizadoPor || null),
      JSON.stringify(historico.mensagens || []),
      JSON.stringify(historico.eventos || [])
    );

  return {
    ...historico,
    id: String(Number(resultado.lastInsertRowid))
  };
}

async function atualizarHistoricoNoBanco(historico) {
  if (!historico?.id) return;

  if (storageMode === "supabase" && supabase) {
    const { error } = await supabase
      .from("tickets")
      .update({
        iniciado_em: historico.iniciadoEm,
        finalizado_em: historico.finalizadoEm,
        motivo: historico.motivo,
        atendente_atual: historico.atendenteAtual || null,
        finalizado_por: historico.finalizadoPor || null,
        mensagens: historico.mensagens || [],
        eventos: historico.eventos || []
      })
      .eq("id", historico.id);

    if (error) {
      throw new Error(`Nao foi possivel atualizar ticket no Supabase: ${error.message}`);
    }
    return;
  }

  if (!db) return;

  db.prepare(`
    UPDATE tickets
    SET
      iniciado_em = ?,
      finalizado_em = ?,
      motivo = ?,
      atendente_atual_json = ?,
      finalizado_por_json = ?,
      mensagens_json = ?,
      eventos_json = ?
    WHERE id = ?
  `).run(
    historico.iniciadoEm,
    historico.finalizadoEm,
    historico.motivo,
    JSON.stringify(historico.atendenteAtual || null),
    JSON.stringify(historico.finalizadoPor || null),
    JSON.stringify(historico.mensagens || []),
    JSON.stringify(historico.eventos || []),
    Number(historico.id)
  );
}

function sanitizarTextosProntos(lista) {
  if (!Array.isArray(lista)) return [...TEXTOS_PRONTOS_PADRAO];

  const sanitizados = lista
    .map((item, indice) => ({
      id: String(item?.id || `texto-${indice + 1}`),
      label: String(item?.label || "").trim().slice(0, 32),
      text: String(item?.text || "").trim().slice(0, 280)
    }))
    .filter((item) => item.label && item.text);

  return sanitizados.length > 0 ? sanitizados : [...TEXTOS_PRONTOS_PADRAO];
}

function carregarTextosProntosLocal() {
  try {
    if (!fs.existsSync(TEXTOS_PRONTOS_PATH)) {
      return sanitizarTextosProntos(TEXTOS_PRONTOS_PADRAO);
    }

    const bruto = fs.readFileSync(TEXTOS_PRONTOS_PATH, "utf-8");
    return sanitizarTextosProntos(JSON.parse(bruto));
  } catch (_) {
    return sanitizarTextosProntos(TEXTOS_PRONTOS_PADRAO);
  }
}

function persistirTextosProntosLocal(lista) {
  textosProntos = sanitizarTextosProntos(lista);
  fs.mkdirSync(path.dirname(TEXTOS_PRONTOS_PATH), { recursive: true });
  fs.writeFileSync(TEXTOS_PRONTOS_PATH, JSON.stringify(textosProntos, null, 2));
  return textosProntos;
}

async function carregarTextosProntos() {
  if (storageMode === "supabase" && supabase) {
    const { data, error } = await supabase
      .from("textos_prontos")
      .select("id, label, text, ativo, ordem")
      .eq("ativo", true)
      .order("ordem", { ascending: true });

    if (error) {
      throw new Error(`Nao foi possivel carregar textos prontos do Supabase: ${error.message}`);
    }

    if (Array.isArray(data) && data.length > 0) {
      textosProntos = sanitizarTextosProntos(data);
      return textosProntos;
    }
  }

  textosProntos = carregarTextosProntosLocal();
  return textosProntos;
}

async function persistirTextosProntos(lista) {
  const sanitizados = sanitizarTextosProntos(lista);

  if (storageMode === "supabase" && supabase) {
    const { error: deleteError } = await supabase.from("textos_prontos").delete().not("id", "is", null);
    if (deleteError) {
      throw new Error(`Nao foi possivel limpar textos prontos no Supabase: ${deleteError.message}`);
    }

    const payload = sanitizados.map((item, indice) => ({
      id: item.id.startsWith("texto-") ? undefined : item.id,
      label: item.label,
      text: item.text,
      ativo: true,
      ordem: indice + 1
    }));

    const { data, error } = await supabase
      .from("textos_prontos")
      .insert(payload)
      .select("id, label, text, ativo, ordem")
      .order("ordem", { ascending: true });

    if (error) {
      throw new Error(`Nao foi possivel salvar textos prontos no Supabase: ${error.message}`);
    }

    textosProntos = sanitizarTextosProntos(data);
    return textosProntos;
  }

  return persistirTextosProntosLocal(sanitizados);
}

function sanitizarFallbackLogin(lista) {
  if (!Array.isArray(lista)) return [];

  return lista
    .map((item) => ({
      email: normalizarEmail(item?.email || ""),
      nome: String(item?.nome || nomeAtendentePadrao(item?.email || "")).trim(),
      role:
        item?.role === "admin"
          ? "admin"
          : item?.role === "operacao"
            ? "operacao"
            : "atendente",
      status: String(item?.status || item?.role || "atendente").trim(),
      senha: normalizarSenhaLogin(item?.senha || ""),
      source: "fallback"
    }))
    .filter((item) => item.email);
}

function carregarFallbackLogins() {
  try {
    if (!fs.existsSync(LOGIN_FALLBACK_PATH)) {
      fs.mkdirSync(path.dirname(LOGIN_FALLBACK_PATH), { recursive: true });
      fs.writeFileSync(LOGIN_FALLBACK_PATH, JSON.stringify(LOGIN_FALLBACK_PADRAO, null, 2));
    }

    const bruto = fs.readFileSync(LOGIN_FALLBACK_PATH, "utf-8");
    const fallback = sanitizarFallbackLogin(JSON.parse(bruto));
    return fallback.length > 0 ? fallback : sanitizarFallbackLogin(LOGIN_FALLBACK_PADRAO);
  } catch (_) {
    return sanitizarFallbackLogin(LOGIN_FALLBACK_PADRAO);
  }
}

function normalizarCpf(valor = "") {
  return String(valor).replace(/\D/g, "").slice(0, 11);
}

function normalizarTelefone(valor = "") {
  return String(valor).replace(/\D/g, "").slice(0, 11);
}

function normalizarEmail(valor = "") {
  return String(valor).trim().toLowerCase();
}

function normalizarSenhaLogin(valor = "") {
  return String(valor).trim().toLowerCase();
}

function normalizarCabecalho(valor = "") {
  return String(valor)
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function parseCsvLine(line) {
  const values = [];
  let atual = "";
  let emAspas = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === "\"") {
      if (emAspas && line[i + 1] === "\"") {
        atual += "\"";
        i += 1;
      } else {
        emAspas = !emAspas;
      }
      continue;
    }

    if (char === "," && !emAspas) {
      values.push(atual);
      atual = "";
      continue;
    }

    atual += char;
  }

  values.push(atual);
  return values.map((item) => item.trim());
}

function parseCsv(texto = "") {
  return texto
    .split(/\r?\n/)
    .filter((linha) => linha.trim())
    .map((linha) => parseCsvLine(linha));
}

function normalizarNumeroPlanilha(valor = "") {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return 0;
  const semSeparadorMilhar = bruto.replace(/\.(?=\d{3}(?:\D|$))/g, "");
  const numero = Number(semSeparadorMilhar.replace(",", "."));
  return Number.isFinite(numero) ? numero : 0;
}

function normalizarNivelPerformance(valor = "") {
  const nivel = normalizarCabecalho(valor).replace(/\s+/g, "");

  if (nivel === "SUPERFOX") return "SUPER FOX";
  if (nivel === "OURO") return "OURO";
  if (nivel === "AGENDABASE") return "AGENDA BASE";
  return String(valor || "").trim();
}

async function carregarEntregadoresDaPlanilha() {
  if (cachePlanilha.expiresAt > Date.now() && cachePlanilha.rows.length > 0) {
    return cachePlanilha.rows;
  }

  const resposta = await fetch(GOOGLE_SHEET_CSV_URL);
  if (!resposta.ok) {
    throw new Error("Nao foi possivel acessar a planilha de entregadores.");
  }

  const csv = await resposta.text();
  const linhas = parseCsv(csv);
  if (linhas.length < 2) {
    cachePlanilha = { expiresAt: Date.now() + PLANILHA_CACHE_MS, rows: [] };
    return [];
  }

  const headers = linhas[0].map((item) => normalizarCabecalho(item));
  const rows = linhas.slice(1).map((colunas) => {
    const registro = {};

    headers.forEach((header, indice) => {
      const valor = String(colunas[indice] || "").trim();
      const headerSemEspaco = header.replace(/\s+/g, "");
      const headerComUnderscore = header.replace(/\s+/g, "_");

      registro[header] = valor;
      registro[headerSemEspaco] = valor;
      registro[headerComUnderscore] = valor;
    });

    const cidade = registro.CIDADE || registro.CIDADE_ || registro["CIDADE "] || "";
    const hotZone =
      registro["HOT ZONE"] ||
      registro.HOTZONE ||
      registro.HOT_ZONE ||
      registro["HOT ZONE "] ||
      registro["HOT  ZONE"] ||
      "";

    return {
      cidade: normalizarCidadeSuporte(cidade),
      hotZone,
      nome: registro.NOME || "",
      celular: normalizarTelefone(registro.CELULAR || ""),
      cpf: normalizarCpf(registro.CPF || ""),
      status: String(registro.STATUS || "").trim().toUpperCase()
    };
  }).filter((item) => item.cpf);

  cachePlanilha = {
    expiresAt: Date.now() + PLANILHA_CACHE_MS,
    rows
  };

  return rows;
}

async function carregarEntregadores() {
  if (cachePlanilha.expiresAt > Date.now() && cachePlanilha.rows.length > 0) {
    return cachePlanilha.rows;
  }

  if (storageMode === "supabase" && supabase) {
    const { data, error } = await supabase
      .from("entregadores")
      .select("cpf, nome, celular, telefone, cidade, regiao, hot_zone, observacoes, status")
      .order("nome", { ascending: true });

    if (error) {
      throw new Error(`Nao foi possivel carregar entregadores do Supabase: ${error.message}`);
    }

    if (Array.isArray(data) && data.length > 0) {
      const rows = data.map((item) => ({
        cpf: normalizarCpf(item.cpf || ""),
        nome: String(item.nome || "").trim(),
        celular: normalizarTelefone(item.celular || item.telefone || ""),
        cidade: normalizarCidadeSuporte(item.cidade || item.regiao || ""),
        hotZone: String(item.hot_zone || "").trim(),
        status: String(item.status || "").trim().toUpperCase()
      })).filter((item) => item.cpf);

      cachePlanilha = {
        expiresAt: Date.now() + PLANILHA_CACHE_MS,
        rows
      };

      return rows;
    }
  }

  return carregarEntregadoresDaPlanilha();
}

async function carregarPerformanceDaPlanilha() {
  if (cachePerformance.expiresAt > Date.now() && cachePerformance.rows.length > 0) {
    return cachePerformance.rows;
  }

  const resposta = await fetch(PERFORMANCE_SHEET_CSV_URL);
  if (!resposta.ok) {
    throw new Error("Nao foi possivel acessar a planilha de performance.");
  }

  const csv = await resposta.text();
  const linhas = parseCsv(csv);
  if (linhas.length < 2) {
    cachePerformance = { expiresAt: Date.now() + PLANILHA_CACHE_MS, rows: [] };
    return [];
  }

  const headers = linhas[0].map((item) => normalizarCabecalho(item));
  const rows = linhas
    .slice(1)
    .map((colunas) => {
      const registro = {};

      headers.forEach((header, indice) => {
        const valor = String(colunas[indice] || "").trim();
        const semEspaco = header.replace(/\s+/g, "");
        const underscore = header.replace(/\s+/g, "_");

        registro[header] = valor;
        registro[semEspaco] = valor;
        registro[underscore] = valor;
      });

      const cpf = normalizarCpf(registro.CPF || "");
      if (!cpf) return null;

      return {
        cpf,
        local: String(registro.LOCAL || "").trim(),
        nome: String(registro.NOME || "").trim(),
        tsh: normalizarNumeroPlanilha(registro.TSH || 0),
        ar: normalizarNumeroPlanilha(registro.AR || 0),
        caa: normalizarNumeroPlanilha(registro.CAA || 0),
        overtime: normalizarNumeroPlanilha(registro.OVERTIME || 0),
        corridas: normalizarNumeroPlanilha(registro.CORRIDAS || 0),
        nivel: normalizarNivelPerformance(registro.NIVEL || "")
      };
    })
    .filter(Boolean);

  cachePerformance = {
    expiresAt: Date.now() + PLANILHA_CACHE_MS,
    rows
  };

  return rows;
}

async function buscarPerformanceDoEntregador(cpf) {
  const rows = await carregarPerformance();
  return rows.find((item) => item.cpf === cpf) || null;
}

async function carregarPerformance() {
  if (cachePerformance.expiresAt > Date.now() && cachePerformance.rows.length > 0) {
    return cachePerformance.rows;
  }

  if (storageMode === "supabase" && supabase) {
    const { data, error } = await supabase
      .from("performance_entregadores")
      .select("cpf, nome, local, tsh, ar, caa, overtime, corridas, nivel")
      .order("nome", { ascending: true });

    if (error) {
      throw new Error(`Nao foi possivel carregar performance do Supabase: ${error.message}`);
    }

    if (Array.isArray(data) && data.length > 0) {
      const rows = data.map((item) => ({
        cpf: normalizarCpf(item.cpf || ""),
        local: String(item.local || "").trim(),
        nome: String(item.nome || "").trim(),
        tsh: Number(item.tsh || 0),
        ar: Number(item.ar || 0),
        caa: Number(item.caa || 0),
        overtime: Number(item.overtime || 0),
        corridas: Number(item.corridas || 0),
        nivel: normalizarNivelPerformance(item.nivel || "")
      })).filter((item) => item.cpf);

      cachePerformance = {
        expiresAt: Date.now() + PLANILHA_CACHE_MS,
        rows
      };

      return rows;
    }
  }

  return carregarPerformanceDaPlanilha();
}

function extrairJsonGviz(resposta = "") {
  const inicio = resposta.indexOf("{");
  const fim = resposta.lastIndexOf("}");
  if (inicio < 0 || fim < 0 || fim <= inicio) {
    throw new Error("Resposta invalida da planilha de login.");
  }

  return JSON.parse(resposta.slice(inicio, fim + 1));
}

function valorCelulaGviz(celula) {
  if (!celula) return "";
  if (typeof celula.f === "string" && celula.f.trim()) return celula.f.trim();
  if (celula.v === null || celula.v === undefined) return "";
  return String(celula.v).trim();
}

function interpretarStatusLogin(status = "") {
  const valor = normalizarCabecalho(status);
  const ativo =
    valor &&
    !valor.includes("INATIV") &&
    !valor.includes("BLOQUE") &&
    !valor.includes("DESLIG") &&
    !valor.includes("SUSPENS");

  let role = "atendente";
  if (valor.includes("ADMIN")) {
    role = "admin";
  } else if (valor.includes("OPERACAO")) {
    role = "operacao";
  }

  return {
    ativo: Boolean(ativo),
    role
  };
}

function nomeAtendentePadrao(email = "") {
  const prefixo = normalizarEmail(email).split("@")[0];
  return prefixo
    .split(/[.\-_]/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(" ");
}

function normalizarCidadeSuporte(valor = "") {
  const cidade = normalizarCabecalho(valor);
  if (cidade.includes("SAO PAULO")) return "Sao Paulo";
  if (cidade.includes("RIO DE JANEIRO")) return "Rio de Janeiro";
  if (cidade.includes("CAMPINAS")) return "Campinas";
  return String(valor || "").trim();
}

async function carregarLoginsDaPlanilha() {
  if (cacheLogin.expiresAt > Date.now() && cacheLogin.rows.length > 0) {
    return cacheLogin.rows;
  }

  const criarRegistroLogin = (registro = {}) => {
    const email = normalizarEmail(
      registro.EMAIL || registro["E MAIL"] || registro["E-MAIL"] || registro.EMAILLOGIN || ""
    );
    const senha = normalizarSenhaLogin(registro.SENHA || registro.PASSWORD || registro.SHA || "");
    const nome = String(registro.NOME || registro.USUARIO || registro.NOMECOMPLETO || "").trim();
    const statusBruto = String(
      registro.STATUS || registro.PERFIL || registro.FUNCAO || registro.CARGO || ""
    ).trim();
    const status = interpretarStatusLogin(statusBruto);

    if (!email || !senha || !status.ativo) {
      return null;
    }

    return {
      email,
      senha,
      nome: nome || nomeAtendentePadrao(email),
      role: status.role,
      status: statusBruto || status.role
    };
  };

  let perfis = [];
  let ultimoErro = null;

  try {
    const resposta = await fetch(LOGIN_SHEET_GVIZ_URL);
    if (!resposta.ok) {
      throw new Error("Nao foi possivel acessar a planilha de login.");
    }

    const bruto = await resposta.text();
    const dados = extrairJsonGviz(bruto);
    const cols = Array.isArray(dados?.table?.cols) ? dados.table.cols : [];
    const rows = Array.isArray(dados?.table?.rows) ? dados.table.rows : [];

    const headers = cols.map((coluna, indice) => {
      const baseHeader = normalizarCabecalho(coluna?.label || coluna?.id || `COLUNA ${indice + 1}`);
      return {
        principal: baseHeader,
        semEspaco: baseHeader.replace(/\s+/g, ""),
        underscore: baseHeader.replace(/\s+/g, "_")
      };
    });

    perfis = rows
      .map((linha) => {
        const registro = {};
        const celulas = Array.isArray(linha?.c) ? linha.c : [];

        headers.forEach((header, indice) => {
          const valor = valorCelulaGviz(celulas[indice]);
          registro[header.principal] = valor;
          registro[header.semEspaco] = valor;
          registro[header.underscore] = valor;
        });

        return criarRegistroLogin(registro);
      })
      .filter(Boolean);
  } catch (error) {
    ultimoErro = error;
  }

  if (perfis.length === 0) {
    try {
      const respostaCsv = await fetch(LOGIN_SHEET_CSV_URL);
      if (!respostaCsv.ok) {
        throw new Error("Nao foi possivel acessar a aba login por CSV.");
      }

      const csv = await respostaCsv.text();
      const linhas = parseCsv(csv);
      if (linhas.length >= 2) {
        const headers = linhas[0].map((item) => normalizarCabecalho(item));

        perfis = linhas
          .slice(1)
          .map((colunas) => {
            const registro = {};

            headers.forEach((header, indice) => {
              const valor = String(colunas[indice] || "").trim();
              const semEspaco = header.replace(/\s+/g, "");
              const underscore = header.replace(/\s+/g, "_");

              registro[header] = valor;
              registro[semEspaco] = valor;
              registro[underscore] = valor;
            });

            return criarRegistroLogin(registro);
          })
          .filter(Boolean);
      }
    } catch (error) {
      ultimoErro = ultimoErro || error;
    }
  }

  if (perfis.length === 0) {
    throw ultimoErro || new Error("Nenhum login ativo foi encontrado na planilha.");
  }

  atendentes = perfis;
  cacheLogin = {
    expiresAt: Date.now() + PLANILHA_CACHE_MS,
    rows: perfis
  };

  return perfis;
}

async function carregarAtendentesAtivos() {
  if (storageMode === "supabase" && supabase) {
    const { data, error } = await supabase
      .from("usuarios_painel")
      .select("email, nome, senha, role, status, regioes")
      .order("nome", { ascending: true });

    if (error) {
      throw new Error(`Nao foi possivel carregar usuarios do Supabase: ${error.message}`);
    }

    if (Array.isArray(data) && data.length > 0) {
      const perfis = data
        .map((item) => {
          const status = interpretarStatusLogin(item.status || item.role || "atendente");
          if (!status.ativo) return null;

          return {
            email: normalizarEmail(item.email || ""),
            nome: String(item.nome || nomeAtendentePadrao(item.email || "")).trim(),
            senha: normalizarSenhaLogin(item.senha || ""),
            role: item.role === "admin" ? "admin" : item.role === "operacao" ? "operacao" : "atendente",
            status: String(item.status || item.role || "atendente").trim(),
            regioes: Array.isArray(item.regioes) ? item.regioes.map((regiao) => normalizarCidadeSuporte(regiao || "")) : [],
            source: "supabase"
          };
        })
        .filter((item) => item?.email);

      atendentes = perfis;
      perfis.forEach((item) => {
        regioesAtendentes[item.email] = Array.isArray(item.regioes) ? [...new Set(item.regioes)] : [];
      });
      cacheLogin = {
        expiresAt: Date.now() + PLANILHA_CACHE_MS,
        rows: perfis
      };

      return perfis;
    }
  }

  try {
    return await carregarLoginsDaPlanilha();
  } catch (error) {
    if (atendentes.length > 0) {
      return atendentes;
    }
  const fallback = carregarFallbackLogins();
  if (fallback.length > 0) {
      atendentes = fallback;
      fallback.forEach((item) => {
        regioesAtendentes[item.email] = [];
      });
      return fallback;
    }
    throw error;
  }
}

async function buscarEntregadorAtivoNaPlanilha(cpf) {
  const rows = await carregarEntregadores();
  return rows.find((item) => item.cpf === cpf && item.status === "ATIVO") || null;
}

function sincronizarEntregadorDaPlanilha(registro) {
  const atual = garantirEntregador(registro.cpf);
  base[registro.cpf] = {
    ...atual,
    cpf: registro.cpf,
    nome: registro.nome,
    telefone: registro.celular,
    celular: registro.celular,
    regiao: registro.cidade,
    cidade: registro.cidade,
    hotZone: registro.hotZone
  };

  return obterEntregador(registro.cpf);
}

async function sincronizarBaseAtivaDaPlanilha() {
  const rows = await carregarEntregadores();
  const ativos = rows.filter((item) => item.status === "ATIVO");
  const unicosPorCpf = new Map();

  ativos.forEach((item) => {
    const atual = unicosPorCpf.get(item.cpf);
    if (!atual) {
      unicosPorCpf.set(item.cpf, item);
      return;
    }

    unicosPorCpf.set(item.cpf, {
      ...atual,
      ...item,
      nome: item.nome || atual.nome,
      celular: item.celular || atual.celular,
      cidade: item.cidade || atual.cidade,
      hotZone: item.hotZone || atual.hotZone
    });
  });

  const deduplicados = [...unicosPorCpf.values()].sort((a, b) =>
    String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" })
  );

  deduplicados.forEach((item) => sincronizarEntregadorDaPlanilha(item));
  return deduplicados.map((item) => obterEntregador(item.cpf));
}

function garantirEntregador(cpf) {
  if (!base[cpf]) {
    base[cpf] = { cpf, nome: "", telefone: "", celular: "", regiao: "", cidade: "", hotZone: "", observacoes: "" };
  }

  if (!conversas[cpf]) {
    conversas[cpf] = [];
  }

  if (!historicos[cpf]) {
    historicos[cpf] = [];
  }

  return base[cpf];
}

function obterAtendente(email) {
  return atendentes.find((item) => item.email === email) || null;
}

function resumoAtendente(email) {
  const atendente = obterAtendente(email);
  if (!atendente) return null;

  return {
    email: atendente.email,
    nome: atendente.nome,
    role: atendente.role,
    disponibilidade: obterDisponibilidade(email),
    regioes: regioesAtendentes[email] || []
  };
}

function atendimentosDoAtendente(email) {
  return Object.keys(atendimentos).filter((cpf) => atendimentos[cpf]?.atendenteEmail === email);
}

function estaOnline(email) {
  return Boolean(sockets[email]);
}

function obterDisponibilidade(email) {
  if (!estaOnline(email)) return "offline";
  return statusAtendentes[email] || "online";
}

function podeReceberNovosAtendimentos(email) {
  return estaOnline(email) && obterDisponibilidade(email) === "online";
}

function listarAtendentesDisponiveis(excluir = []) {
  return atendentes.filter(
    (item) =>
      (item.role === "atendente" || item.role === "admin" || item.role === "operacao") &&
      podeReceberNovosAtendimentos(item.email) &&
      !excluir.includes(item.email)
  );
}

function atendentesConfiguradosParaRegiao(regiao) {
  return atendentes.filter((item) => (regioesAtendentes[item.email] || []).includes(regiao));
}

function filtrarAtendentesPorRegiao(disponiveis, regiao) {
  const configurados = atendentesConfiguradosParaRegiao(regiao);
  if (configurados.length === 0) {
    return disponiveis;
  }

  return disponiveis.filter((item) => (regioesAtendentes[item.email] || []).includes(regiao));
}

function podeAtenderRegiao(email, regiao) {
  const regioes = regioesAtendentes[email] || [];
  return regioes.length === 0 || regioes.includes(regiao);
}

function procurarAtendenteParaFila(cpf) {
  const entregador = garantirEntregador(cpf);
  const disponiveis = filtrarAtendentesPorRegiao(listarAtendentesDisponiveis(), entregador.regiao || "");
  if (disponiveis.length === 0) return null;

  return disponiveis.sort(
    (a, b) => atendimentosDoAtendente(a.email).length - atendimentosDoAtendente(b.email).length
  )[0];
}

function obterEntregador(cpf) {
  const entregador = garantirEntregador(cpf);
  const atendimento = atendimentos[cpf];

  return {
    ...entregador,
    cpf,
    status: atendimento ? "Em atendimento" : fila.includes(cpf) ? "Aguardando" : "Offline",
    mensagens: conversas[cpf].length,
    atendenteAtual: atendimento ? resumoAtendente(atendimento.atendenteEmail) : null
  };
}

function filaDetalhada() {
  return fila.map((cpf) => obterEntregador(cpf));
}

function filaDetalhadaParaAtendente(email) {
  const perfil = obterAtendente(email);
  const filaAtual = filaDetalhada();
  if (!perfil) return filaAtual;

  return filaAtual.filter((item) => podeAtenderRegiao(email, item.regiao || ""));
}

function filtrarEntregadoresPorAtendente(entregadores, email) {
  const perfil = obterAtendente(email);
  if (!perfil) return entregadores;

  return entregadores.filter((item) => podeAtenderRegiao(email, item.regiao || ""));
}

function listarEntregadores() {
  return Object.keys(base).map((cpf) => obterEntregador(cpf));
}

function listarAtendimentosAtivos() {
  return Object.entries(atendimentos).map(([cpf, atendimento]) => ({
    cpf,
    entregador: obterEntregador(cpf),
    atendente: resumoAtendente(atendimento.atendenteEmail),
    iniciadoEm: atendimento.iniciadoEm,
    ultimaMensagemEntregadorEm: atendimento.ultimaMensagemEntregadorEm || null,
    ultimaMensagemAtendenteEm: atendimento.ultimaMensagemAtendenteEm || null,
    aguardandoResposta: Boolean(atendimento.aguardandoRespostaDesde),
    messages: conversas[cpf] || []
  }));
}

function listarStatusAtendentes() {
  return atendentes
    .filter((item) => item.role === "atendente" || item.role === "admin" || item.role === "operacao")
    .map((item) => {
      const cpfs = atendimentosDoAtendente(item.email);
      const disponibilidade = obterDisponibilidade(item.email);
      return {
        ...resumoAtendente(item.email),
        online: estaOnline(item.email),
        disponibilidade,
        status:
          disponibilidade === "offline"
            ? "Offline"
            : disponibilidade === "ausente"
              ? "Ausente"
              : cpfs.length > 0
                ? "Em atendimento"
                : "Online",
        conversas: cpfs.map((cpf) => ({
          cpf,
          entregador: obterEntregador(cpf),
          messages: conversas[cpf] || [],
          aguardandoResposta: Boolean(atendimentos[cpf]?.aguardandoRespostaDesde)
        }))
      };
    });
}

function montarPainelEstado(email) {
  const perfil = obterAtendente(email);

  return {
    fila: perfil ? filaDetalhadaParaAtendente(email) : filaDetalhada(),
    ativos: listarAtendimentosAtivos(),
    atendentes: listarStatusAtendentes()
  };
}

function emitirFila() {
  atendentes.forEach((item) => {
    const socketId = sockets[item.email];
    if (!socketId) return;
    io.to(socketId).emit("fila", filaDetalhadaParaAtendente(item.email));
  });
}

function emitirPainelGeral() {
  atendentes.forEach((item) => {
    const socketId = sockets[item.email];
    if (!socketId) return;
    io.to(socketId).emit("painel_estado", montarPainelEstado(item.email));
  });
}

function emitirEstadoEntregador(cpf) {
  const socketId = sockets[cpf];
  if (!socketId) return;

  marcarMensagensEntregues(cpf, "entregador");
  const atendimento = atendimentos[cpf];

  io.to(socketId).emit("estado_entregador", {
    cpf,
    entregador: obterEntregador(cpf),
    status: atendimento ? "em_atendimento" : fila.includes(cpf) ? "aguardando" : "encerrado",
    atendente: atendimento ? resumoAtendente(atendimento.atendenteEmail) : null,
    messages: conversas[cpf] || [],
    history: historicos[cpf] || []
  });
}

function emitirConversaParaPainel(email, cpf) {
  const socketId = sockets[email];
  if (!socketId || !cpf) return;

  marcarMensagensEntregues(cpf, "atendente");
  chatsAbertos[email] = cpf;

  io.to(socketId).emit("chat_assigned", {
    cpf,
    entregador: obterEntregador(cpf),
    atendente: atendimentos[cpf] ? resumoAtendente(atendimentos[cpf].atendenteEmail) : null,
    messages: conversas[cpf] || [],
    history: historicos[cpf] || [],
    supervisao: Boolean(obterAtendente(email)?.role === "admin")
  });
}

function emitirRemocaoMensagem(cpf, messageId) {
  const atendimento = atendimentos[cpf];
  const donos = new Set();

  if (atendimento?.atendenteEmail) {
    donos.add(atendimento.atendenteEmail);
  }

  atendentes
    .filter((item) => item.role === "admin" && sockets[item.email])
    .forEach((item) => donos.add(item.email));

  donos.forEach((email) => {
    if (sockets[email]) {
      io.to(sockets[email]).emit("msg_deleted", { cpf, messageId });
    }
  });

  if (sockets[cpf]) {
    io.to(sockets[cpf]).emit("msg_deleted", { cpf, messageId });
  }
}

function limparTimer(cpf) {
  if (atendimentos[cpf]?.timerResposta) {
    clearTimeout(atendimentos[cpf].timerResposta);
    atendimentos[cpf].timerResposta = null;
  }
}

function registrarEventoSessao(cpf, tipo, meta = {}) {
  const atendimento = atendimentos[cpf];
  if (!atendimento) return;

  atendimento.eventos.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tipo,
    at: new Date().toISOString(),
    ...meta
  });
}

function recolocarNaFila(cpf) {
  if (!fila.includes(cpf)) {
    fila.unshift(cpf);
  }
}

function tentarAtribuirFila() {
  for (let indice = 0; indice < fila.length; ) {
    const cpf = fila[indice];
    const atendente = procurarAtendenteParaFila(cpf);
    if (!atendente) {
      indice += 1;
      continue;
    }

    fila.splice(indice, 1);
    iniciarAtendimento(cpf, atendente.email, "auto_online");
  }
}

function garantirNaFila(cpf) {
  if (!cpf || atendimentos[cpf]) return;
  if (!fila.includes(cpf)) {
    fila.unshift(cpf);
  }
}

function reagendarPorTimeout(cpf) {
  const atendimento = atendimentos[cpf];
  if (!atendimento || !atendimento.aguardandoRespostaDesde) return;

  limparTimer(cpf);

  atendimento.timerResposta = setTimeout(() => {
    const atual = atendimentos[cpf];
    if (!atual || !atual.aguardandoRespostaDesde) return;

    const anterior = atual.atendenteEmail;
    const proximo = filtrarAtendentesPorRegiao(
      listarAtendentesDisponiveis([anterior]),
      garantirEntregador(cpf).regiao || ""
    )[0];

    if (proximo) {
      atual.atendenteEmail = proximo.email;
      atual.transferidoEm = new Date().toISOString();
      atual.aguardandoRespostaDesde = null;
      atual.ultimaMensagemAtendenteEm = null;
      registrarEventoSessao(cpf, "reatribuido_timeout", {
        de: resumoAtendente(anterior),
        para: resumoAtendente(proximo.email)
      });

      if (sockets[anterior]) {
        io.to(sockets[anterior]).emit("chat_transferido", {
          cpf,
          motivo: "Sem resposta em 5 minutos."
        });
      }

      emitirConversaParaPainel(proximo.email, cpf);
      emitirEstadoEntregador(cpf);
      emitirPainelGeral();
      return;
    }

    delete atendimentos[cpf];
    limparTimer(cpf);
    recolocarNaFila(cpf);

    if (sockets[anterior]) {
      io.to(sockets[anterior]).emit("chat_transferido", {
        cpf,
        motivo: "Sem resposta em 5 minutos. O entregador voltou para a fila."
      });
    }

    emitirEstadoEntregador(cpf);
    emitirFila();
    emitirPainelGeral();
  }, TEMPO_REATRIBUICAO_MS);
}

function iniciarAtendimento(cpf, atendenteEmail, origem = "fila") {
  garantirEntregador(cpf);

  if (!atendimentos[cpf]) {
    atendimentos[cpf] = {
      atendenteEmail,
      iniciadoEm: new Date().toISOString(),
      ultimaMensagemEntregadorEm: null,
      ultimaMensagemAtendenteEm: null,
      aguardandoRespostaDesde: null,
      timerResposta: null,
      mensagensSessao: [],
      eventos: []
    };
  } else {
    limparTimer(cpf);
    atendimentos[cpf].atendenteEmail = atendenteEmail;
  }

  registrarEventoSessao(cpf, "assumiu", {
    atendente: resumoAtendente(atendenteEmail),
    origem
  });

  const indiceFila = fila.indexOf(cpf);
  if (indiceFila >= 0) {
    fila.splice(indiceFila, 1);
  }

  emitirFila();
  emitirPainelGeral();
  emitirConversaParaPainel(atendenteEmail, cpf);
  emitirEstadoEntregador(cpf);

  if (sockets[cpf]) {
    io.to(sockets[cpf]).emit("atendente_atribuido", {
      cpf,
      atendente: resumoAtendente(atendenteEmail)
    });
  }
}

function transferirAtendimento(cpf, deEmail, paraEmail, origem = "transferencia") {
  if (!atendimentos[cpf]) return false;
  if (!podeReceberNovosAtendimentos(paraEmail)) return false;
  if (!podeAtenderRegiao(paraEmail, garantirEntregador(cpf).regiao || "")) return false;

  iniciarAtendimento(cpf, paraEmail, origem);

  if (deEmail && deEmail !== paraEmail && sockets[deEmail]) {
    io.to(sockets[deEmail]).emit("chat_transferido", {
      cpf,
      motivo: `Atendimento transferido para ${obterAtendente(paraEmail)?.nome || paraEmail}.`
    });
  }

  return true;
}

function registrarMensagem({ cpf, from, text, media = null, meta = {} }) {
  garantirEntregador(cpf);

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cpf,
    from,
    text,
    media,
    createdAt: new Date().toISOString(),
    deliveredToCounterpartAt: null,
    seenByCounterpartAt: null,
    ...meta
  };

  conversas[cpf].push(message);

  if (atendimentos[cpf]) {
    atendimentos[cpf].mensagensSessao.push(message);
  }

  return message;
}

function ehMensagemDoAtendente(message) {
  return String(message?.from || "").includes("@");
}

function donosDaConversa(cpf) {
  const emails = new Set();
  const atendimento = atendimentos[cpf];

  if (atendimento?.atendenteEmail) {
    emails.add(atendimento.atendenteEmail);
  }

  atendentes
    .filter((item) => item.role === "admin" && sockets[item.email])
    .forEach((item) => emails.add(item.email));

  return emails;
}

function emitirStatusMensagem(cpf, mensagem) {
  if (!mensagem) return;

  donosDaConversa(cpf).forEach((email) => {
    if (sockets[email]) {
      io.to(sockets[email]).emit("msg_status", { cpf, message: mensagem });
    }
  });

  if (sockets[cpf]) {
    io.to(sockets[cpf]).emit("msg_status", { cpf, message: mensagem });
  }
}

function marcarMensagensEntregues(cpf, destino) {
  const viewerEhAtendente = destino === "atendente";
  const agora = new Date().toISOString();
  const atualizadas = [];

  (conversas[cpf] || []).forEach((mensagem) => {
    const veioDoAtendente = ehMensagemDoAtendente(mensagem);
    const mensagemDoOutroLado = viewerEhAtendente ? !veioDoAtendente : veioDoAtendente;

    if (mensagemDoOutroLado && !mensagem.deliveredToCounterpartAt) {
      mensagem.deliveredToCounterpartAt = agora;
      atualizadas.push(mensagem);
    }
  });

  atualizadas.forEach((mensagem) => emitirStatusMensagem(cpf, mensagem));
}

function marcarMensagensLidas(cpf, viewer) {
  const viewerId = String(viewer || "");
  const viewerEhAtendente = viewerId.includes("@");
  const agora = new Date().toISOString();
  const atualizadas = [];

  (conversas[cpf] || []).forEach((mensagem) => {
    const veioDoAtendente = ehMensagemDoAtendente(mensagem);
    const mensagemDoOutroLado = viewerEhAtendente ? !veioDoAtendente : veioDoAtendente;

    if (!mensagemDoOutroLado || mensagem.seenByCounterpartAt) {
      return;
    }

    if (!mensagem.deliveredToCounterpartAt) {
      mensagem.deliveredToCounterpartAt = agora;
    }

    mensagem.seenByCounterpartAt = agora;
    atualizadas.push(mensagem);
  });

  atualizadas.forEach((mensagem) => emitirStatusMensagem(cpf, mensagem));
}

async function removerMensagem(cpf, messageId) {
  if (!conversas[cpf]) return false;

  const originalLength = conversas[cpf].length;
  conversas[cpf] = conversas[cpf].filter((item) => item.id !== messageId);

  if (conversas[cpf].length === originalLength) {
    return false;
  }

  if (atendimentos[cpf]) {
    atendimentos[cpf].mensagensSessao = atendimentos[cpf].mensagensSessao.filter((item) => item.id !== messageId);
  }

  historicos[cpf] = (historicos[cpf] || []).map((item) => ({
    ...item,
    mensagens: (item.mensagens || []).filter((mensagem) => mensagem.id !== messageId)
  }));
  await Promise.all((historicos[cpf] || []).map((item) => atualizarHistoricoNoBanco(item)));

  return true;
}

function obterUltimoDisparo(cpf) {
  const mensagens = conversas[cpf] || [];
  return [...mensagens]
    .reverse()
    .find((item) => item?.kind === "broadcast" && item?.text);
}

async function finalizarAtendimento(cpf, finalizadoPor, motivo = "finalizado") {
  const atendimento = atendimentos[cpf];
  if (!atendimento) return null;

  limparTimer(cpf);
  const mensagensDoHistorico = atendimento.mensagensSessao?.length
    ? [...atendimento.mensagensSessao]
    : [...(conversas[cpf] || [])];
  const historico = {
    id: "",
    cpf,
    iniciadoEm: atendimento.iniciadoEm,
    finalizadoEm: new Date().toISOString(),
    motivo,
    atendenteAtual: resumoAtendente(atendimento.atendenteEmail),
    finalizadoPor: resumoAtendente(finalizadoPor),
    mensagens: mensagensDoHistorico,
    eventos: atendimento.eventos
  };

  const historicoPersistido = await inserirHistoricoNoBanco(historico);
  historicos[cpf].unshift(historicoPersistido);
  delete atendimentos[cpf];

  return historicoPersistido;
}

async function limparTodosHistoricos() {
  Object.keys(historicos).forEach((cpf) => {
    historicos[cpf] = [];
  });
  if (storageMode === "supabase" && supabase) {
    const { error } = await supabase.from("tickets").delete().not("id", "is", null);
    if (error) {
      throw new Error(`Nao foi possivel limpar tickets no Supabase: ${error.message}`);
    }
    return;
  }
  if (db) {
    db.exec("DELETE FROM tickets;");
  }
}

app.get("/health", (_, res) => {
  res.json({ ok: true, port: PORT, storage: storageMode });
});

app.post("/admin/limpar-tickets", async (_req, res) => {
  try {
    await limparTodosHistoricos();
    emitirPainelGeral();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nao foi possivel limpar os tickets." });
  }
});

app.post("/login", async (req, res) => {
  const email = normalizarEmail(req.body.email);
  const senha = normalizarSenhaLogin(req.body.senha || "");

  try {
    const perfis = await carregarAtendentesAtivos();
    const user = perfis.find((item) => {
      if (item.email !== email) return false;
      if (item.source === "fallback" && !item.senha) {
        return true;
      }
      return item.senha === senha;
    });

    if (!user) {
      return res.status(401).json({ error: "Email ou senha invalidos, ou usuario sem permissao de acesso." });
    }

    return res.json({
      email: user.email,
      nome: user.nome,
      role: user.role,
      status: user.status
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nao foi possivel validar o login." });
  }
});

app.get("/entregadores/:cpf", async (req, res) => {
  const cpf = normalizarCpf(req.params.cpf);
  if (!cpf) {
    return res.status(400).json({ error: "CPF invalido" });
  }

  try {
    const registro = await buscarEntregadorAtivoNaPlanilha(cpf);
    if (registro) {
      sincronizarEntregadorDaPlanilha(registro);
    }
  } catch (_) {
  }

  return res.json({
    entregador: obterEntregador(cpf),
    messages: conversas[cpf] || [],
    history: historicos[cpf] || []
  });
});

app.get("/entregadores/:cpf/performance", async (req, res) => {
  const cpf = normalizarCpf(req.params.cpf);
  if (!cpf) {
    return res.status(400).json({ error: "CPF invalido" });
  }

  try {
    const performance = await buscarPerformanceDoEntregador(cpf);
    if (!performance) {
      return res.status(404).json({ error: "Performance nao encontrada para este CPF." });
    }

    return res.json({ performance });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nao foi possivel carregar a performance." });
  }
});

app.get("/entregadores", async (req, res) => {
  const regiao = String(req.query.regiao || "").trim().toLowerCase();
  const email = normalizarEmail(req.query.email || "");

  try {
    const entregadores = filtrarEntregadoresPorAtendente(
      (await sincronizarBaseAtivaDaPlanilha()).filter((item) =>
        regiao ? String(item.regiao || "").toLowerCase() === regiao : true
      ),
      email
    );

    return res.json({ entregadores });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nao foi possivel carregar a base de entregadores." });
  }
});

app.get("/config/suportes", (_, res) => {
  return res.json({
    regioes: REGIOES_SUPORTE,
    atendentes: listarStatusAtendentes()
  });
});

app.get("/config/textos-prontos", async (_, res) => {
  try {
    const atualizados = await carregarTextosProntos();
    return res.json({ textosProntos: atualizados });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nao foi possivel carregar os textos prontos." });
  }
});

app.post("/config/textos-prontos", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const perfil = obterAtendente(email);

  if (!perfil) {
    return res.status(403).json({ error: "Atendente nao autorizado para editar mensagens prontas." });
  }

  try {
    const atualizados = await persistirTextosProntos(req.body.textosProntos);
    return res.json({ ok: true, textosProntos: atualizados });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nao foi possivel salvar as mensagens prontas." });
  }
});

app.post("/entregadores/entrar", async (req, res) => {
  const cpf = normalizarCpf(req.body.cpf);

  if (cpf.length !== 11) {
    return res.status(400).json({ error: "CPF invalido" });
  }

  try {
    const registro = await buscarEntregadorAtivoNaPlanilha(cpf);
    if (!registro) {
      return res.status(403).json({ error: "CPF nao encontrado na base ou com status diferente de ATIVO." });
    }

    const payload = sincronizarEntregadorDaPlanilha(registro);
    io.emit("entregador_atualizado", payload);
    emitirPainelGeral();

    return res.json({ ok: true, entregador: payload });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Nao foi possivel validar o CPF." });
  }
});

app.post("/salvar", (req, res) => {
  const cpf = normalizarCpf(req.body.cpf);
  const dados = req.body.dados || {};

  if (!cpf) {
    return res.status(400).json({ error: "CPF invalido" });
  }

  const atual = garantirEntregador(cpf);
  base[cpf] = { ...atual, ...dados, cpf };

  const payload = obterEntregador(cpf);
  io.emit("entregador_atualizado", payload);
  emitirPainelGeral();

  return res.json({ ok: true, entregador: payload });
});

app.post("/disparo", (req, res) => {
  const mensagem = String(req.body.mensagem || "").trim();
  const destinos = Array.isArray(req.body.cpfs) ? req.body.cpfs : [];
  const mediaRaw = req.body.media;
  const atendenteEmail = req.body.atendente;
  const atendente = obterAtendente(atendenteEmail);
  const media =
    mediaRaw &&
    typeof mediaRaw === "object" &&
    ["image", "video", "file", "audio"].includes(String(mediaRaw.type || "")) &&
    String(mediaRaw.dataUrl || "").startsWith("data:") &&
    String(mediaRaw.dataUrl || "").length <= 20_000_000
      ? {
          type: String(mediaRaw.type || ""),
          name: String(mediaRaw.name || "").slice(0, 180),
          mimeType: String(mediaRaw.mimeType || "").slice(0, 180),
          dataUrl: String(mediaRaw.dataUrl || "")
        }
      : null;
  const contatos = destinos
    .map((item) => {
      if (typeof item === "string") {
        return { cpf: normalizarCpf(item), conta: "" };
      }

      return {
        cpf: normalizarCpf(item?.cpf || item?.numero || ""),
        conta: String(item?.conta || item?.nome || "").trim()
      };
    })
    .filter((item) => item.cpf);

  if (!mensagem && !media) {
    return res.status(400).json({ error: "Mensagem ou anexo obrigatorio" });
  }

  if (contatos.length === 0) {
    return res.status(400).json({ error: "Selecione ao menos um entregador" });
  }

  contatos.forEach(({ cpf, conta }) => {
    if (conta) {
      const atual = garantirEntregador(cpf);
      base[cpf] = {
        ...atual,
        nome: atual.nome || conta
      };
    }

    const payload = registrarMensagem({
      cpf,
      from: atendente?.email || "sistema@foxlog.com",
      text: mensagem,
      media,
      meta: {
        kind: "broadcast",
        title: "Aviso da operacao"
      }
    });

    if (sockets[cpf]) {
      io.to(sockets[cpf]).emit("msg", payload);
      io.to(sockets[cpf]).emit("broadcast_notice", {
        title: "Aviso da operacao",
        text: mensagem,
        media,
        cpf
      });
    }
  });

  return res.json({ ok: true, total: contatos.length });
});

io.on("connection", (socket) => {
  socket.on("login", async ({ id, tipo, nome, telefone, regiao }) => {
    if (tipo === "entregador") {
      const cpf = normalizarCpf(id);
      if (!cpf) return;

      socket.data = { id: cpf, tipo };
      sockets[cpf] = socket.id;
      const atual = garantirEntregador(cpf);

      const regiaoValida = REGIOES_SUPORTE.includes(String(regiao || "").trim())
        ? String(regiao || "").trim()
        : atual.regiao || "";

      if (nome || telefone || regiaoValida) {
        base[cpf] = {
          ...atual,
          cpf,
          nome: String(nome || atual.nome || "").trim(),
          telefone: normalizarTelefone(telefone || atual.telefone || ""),
          regiao: regiaoValida
        };
        io.emit("entregador_atualizado", obterEntregador(cpf));
      }

      if (!fila.includes(cpf) && !atendimentos[cpf]) {
        fila.push(cpf);
      }

      emitirFila();
      emitirPainelGeral();
      emitirEstadoEntregador(cpf);

      const ultimoDisparo = obterUltimoDisparo(cpf);
      if (ultimoDisparo) {
        io.to(socket.id).emit("broadcast_notice", {
          title: ultimoDisparo.title || "Aviso da operacao",
          text: ultimoDisparo.text,
          cpf
        });
      }
      return;
    }

    if (tipo === "atendente") {
      try {
        await carregarAtendentesAtivos();
      } catch (_) {
      }

      const email = normalizarEmail(id);
      const perfil = obterAtendente(email);
      if (!perfil) {
        io.to(socket.id).emit("erro_atendimento", "Seu acesso nao foi encontrado na base de login.");
        return;
      }

      socket.data = { id: email, tipo, role: perfil.role || "atendente" };
      sockets[email] = socket.id;
      statusAtendentes[email] = "online";

      io.to(socket.id).emit("painel_estado", montarPainelEstado(email));

      const conversasAtivas = atendimentosDoAtendente(email);
      if (conversasAtivas[0]) {
        emitirConversaParaPainel(email, conversasAtivas[0]);
      }

    }
  });

  socket.on("set_status", ({ email, status }) => {
    const perfil = obterAtendente(email);
    if (!perfil || !estaOnline(email)) return;

    const valor = status === "ausente" ? "ausente" : "online";
    statusAtendentes[email] = valor;
    emitirPainelGeral();

  });

  socket.on("set_regioes_atendente", async ({ admin, email, regioes }) => {
    const perfil = obterAtendente(admin);
    const destino = obterAtendente(email);
    if (!perfil || perfil.role !== "admin" || !destino) return;

    const lista = Array.isArray(regioes)
      ? regioes.filter((item) => REGIOES_SUPORTE.includes(String(item)))
      : [];

    regioesAtendentes[email] = [...new Set(lista)];
    if (storageMode === "supabase" && supabase && destino.source === "supabase") {
      await supabase.from("usuarios_painel").update({ regioes: regioesAtendentes[email] }).eq("email", email);
      cacheLogin.expiresAt = 0;
    }
    emitirPainelGeral();
  });

  socket.on("abrir_conversa", ({ email, cpf }) => {
    const perfil = obterAtendente(email);
    const idCpf = normalizarCpf(cpf);
    if (!perfil || !idCpf) return;

    if (!base[idCpf] && !atendimentos[idCpf] && !(historicos[idCpf] || []).length) {
      io.to(sockets[email]).emit("erro_atendimento", "Conversa nao encontrada.");
      return;
    }

    if (perfil.role !== "admin" && atendimentos[idCpf]?.atendenteEmail !== email) {
      io.to(sockets[email]).emit("erro_atendimento", "Voce nao pode abrir a conversa de outro atendente.");
      return;
    }

    emitirConversaParaPainel(email, idCpf);
  });

  socket.on("abrir_conversa_ativa", ({ email, cpf }) => {
    const perfil = obterAtendente(email);
    const idCpf = normalizarCpf(cpf);
    if (!perfil || !idCpf || !base[idCpf]) return;

    const entregador = garantirEntregador(idCpf);
    if (!podeAtenderRegiao(email, entregador.regiao || "")) {
      io.to(sockets[email]).emit("erro_atendimento", "Esse entregador pertence a outra regiao configurada.");
      return;
    }

    if (!atendimentos[idCpf]) {
      iniciarAtendimento(idCpf, email, "proativo");
      return;
    }

    if (perfil.role !== "admin" && atendimentos[idCpf].atendenteEmail !== email) {
      io.to(sockets[email]).emit("erro_atendimento", "Essa conversa ja esta com outro suporte.");
      return;
    }

    emitirConversaParaPainel(email, idCpf);
  });

  socket.on("assumir_conversa", ({ email, cpf }) => {
    const perfil = obterAtendente(email);
    const idCpf = normalizarCpf(cpf);
    if (!perfil || !idCpf || perfil.role !== "admin" || !base[idCpf]) return;

    const anterior = atendimentos[idCpf]?.atendenteEmail || null;
    const assumido = transferirAtendimento(idCpf, anterior, email, "supervisao");
    if (!assumido) {
      io.to(sockets[email]).emit("erro_atendimento", "Nao foi possivel assumir essa conversa agora.");
      return;
    }

    if (anterior && anterior !== email && sockets[anterior]) {
      io.to(sockets[anterior]).emit("chat_transferido", {
        cpf: idCpf,
        motivo: `Atendimento assumido por ${perfil.nome}.`
      });
    }
  });

  socket.on("transferir_conversa", ({ email, cpf, para }) => {
    const perfil = obterAtendente(email);
    const idCpf = normalizarCpf(cpf);
    const destino = String(para || "").trim().toLowerCase();
    const atendimento = atendimentos[idCpf];

    if (!perfil || !idCpf || !atendimento) return;

    if (perfil.role !== "admin" && atendimento.atendenteEmail !== email) {
      io.to(sockets[email]).emit("erro_atendimento", "Voce nao pode transferir esta conversa.");
      return;
    }

    const destinoPerfil = obterAtendente(destino);
    if (!destinoPerfil) {
      io.to(sockets[email]).emit("erro_atendimento", "Atendente de destino nao encontrado.");
      return;
    }

    if (!podeReceberNovosAtendimentos(destinoPerfil.email)) {
      io.to(sockets[email]).emit("erro_atendimento", "Esse atendente nao esta online para receber transferencias.");
      return;
    }

    if (destinoPerfil.email === atendimento.atendenteEmail) {
      io.to(sockets[email]).emit("erro_atendimento", "Essa conversa ja esta com esse atendente.");
      return;
    }

    transferirAtendimento(idCpf, atendimento.atendenteEmail, destinoPerfil.email, "transferencia");
  });

  socket.on("delete_msg", async ({ email, cpf, messageId }) => {
    const perfil = obterAtendente(email);
    const idCpf = normalizarCpf(cpf);
    if (!perfil || !idCpf || !messageId) return;

    if (perfil.role !== "admin") {
      io.to(sockets[email]).emit("erro_atendimento", "Somente admin pode apagar mensagens.");
      return;
    }

    const removido = await removerMensagem(idCpf, messageId);
    if (!removido) return;

    emitirRemocaoMensagem(idCpf, messageId);
    emitirPainelGeral();
    emitirEstadoEntregador(idCpf);
  });

  socket.on("marcar_lidas", ({ viewer, cpf }) => {
    const idCpf = normalizarCpf(cpf);
    if (!idCpf) return;

    marcarMensagensLidas(idCpf, viewer || socket.data?.id || "");
  });

  socket.on("msg", ({ from, to, text, media }) => {
    const mensagem = String(text || "").trim();
    const payloadMedia =
      media && typeof media === "object"
        ? {
            type: media.type === "audio" ? "audio" : media.type === "image" ? "image" : "",
            name: String(media.name || "").slice(0, 120),
            mimeType: String(media.mimeType || "").slice(0, 120),
            dataUrl: String(media.dataUrl || "")
          }
        : null;

    const mediaValida =
      payloadMedia &&
      payloadMedia.type &&
      payloadMedia.dataUrl.startsWith("data:") &&
      payloadMedia.dataUrl.length <= 12_000_000
        ? payloadMedia
        : null;

    if (!mensagem && !mediaValida) return;

    const remetente = String(from || "");
    const destinoCpf =
      typeof to === "string"
        ? to
        : to && typeof to === "object" && "cpf" in to
          ? to.cpf
          : "";

    const cpf = remetente.includes("@") ? normalizarCpf(destinoCpf) : normalizarCpf(remetente);
    if (!cpf) return;

    const payload = registrarMensagem({ cpf, from: remetente, text: mensagem, media: mediaValida });
    let atendimento = atendimentos[cpf];

    if (!atendimento && !remetente.includes("@")) {
      garantirNaFila(cpf);
      emitirFila();
      emitirPainelGeral();
    }

    if (atendimento) {
      if (remetente.includes("@")) {
        atendimento.ultimaMensagemAtendenteEm = payload.createdAt;
        atendimento.aguardandoRespostaDesde = null;
        limparTimer(cpf);
      } else {
        atendimento.ultimaMensagemEntregadorEm = payload.createdAt;
        atendimento.aguardandoRespostaDesde = payload.createdAt;
        reagendarPorTimeout(cpf);
      }
    }

    const atendenteEmail = atendimento?.atendenteEmail;
    if (atendenteEmail && sockets[atendenteEmail]) {
      if (!remetente.includes("@")) {
        marcarMensagensEntregues(cpf, "atendente");
      }
      emitirConversaParaPainel(atendenteEmail, cpf);
      io.to(sockets[atendenteEmail]).emit("msg", payload);
    }

    if (remetente.includes("@") && sockets[remetente]) {
      io.to(sockets[remetente]).emit("msg_confirmed", payload);
    }

    atendentes
      .filter((item) => item.role === "admin" && sockets[item.email])
      .forEach((item) => {
        io.to(sockets[item.email]).emit("msg", payload);
      });

    if (sockets[cpf]) {
      if (remetente.includes("@")) {
        marcarMensagensEntregues(cpf, "entregador");
      }
      io.to(sockets[cpf]).emit("msg", payload);
      io.to(sockets[cpf]).emit("msg_confirmed", payload);
      emitirEstadoEntregador(cpf);
    }

    emitirPainelGeral();
  });

  socket.on("finalizar_atendimento", async ({ atendente, cpf }) => {
    const perfil = obterAtendente(atendente);
    if (!perfil) return;

    const idCpf = normalizarCpf(cpf);
    if (!idCpf || !atendimentos[idCpf]) return;

    if (perfil.role !== "admin" && atendimentos[idCpf].atendenteEmail !== atendente) {
      io.to(sockets[atendente]).emit("erro_atendimento", "Voce nao pode finalizar o atendimento de outro atendente.");
      return;
    }

    const mensagemEncerramento = registrarMensagem({
      cpf: idCpf,
      from: atendente,
      text: MENSAGEM_FINALIZACAO_PADRAO
    });

    if (sockets[atendente]) {
      io.to(sockets[atendente]).emit("msg_confirmed", mensagemEncerramento);
      io.to(sockets[atendente]).emit("msg", mensagemEncerramento);
    }

    atendentes
      .filter((item) => item.role === "admin" && sockets[item.email])
      .forEach((item) => {
        io.to(sockets[item.email]).emit("msg", mensagemEncerramento);
      });

    if (sockets[idCpf]) {
      marcarMensagensEntregues(idCpf, "entregador");
      io.to(sockets[idCpf]).emit("msg", mensagemEncerramento);
      io.to(sockets[idCpf]).emit("msg_confirmed", mensagemEncerramento);
    }

    const historico = await finalizarAtendimento(idCpf, atendente, "finalizado");

    Object.keys(chatsAbertos).forEach((email) => {
      if (chatsAbertos[email] === idCpf && sockets[email]) {
        io.to(sockets[email]).emit("atendimento_finalizado", { cpf: idCpf, history: historico });
      }
    });

    if (sockets[idCpf]) {
      io.to(sockets[idCpf]).emit("atendimento_finalizado", { cpf: idCpf });
      io.to(sockets[idCpf]).emit("estado_entregador", {
        cpf: idCpf,
        entregador: obterEntregador(idCpf),
        status: "encerrado",
        atendente: null,
        messages: conversas[idCpf] || []
      });
    }

    emitirFila();
    emitirPainelGeral();
  });

  socket.on("disconnect", () => {
    const { id, tipo } = socket.data || {};
    if (!id || !tipo) return;

    if (sockets[id] === socket.id) {
      delete sockets[id];
    }

    if (tipo === "atendente") {
      statusAtendentes[id] = "offline";
    }

    if (tipo === "entregador") {
      const indice = fila.indexOf(id);
      if (indice >= 0) {
        fila.splice(indice, 1);
      }
    }

    emitirFila();
    emitirPainelGeral();
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`A porta ${PORT} ja esta em uso. Se o sistema ja estiver aberto, acesse http://localhost:${PORT}/`);
    return;
  }

  throw error;
});

async function iniciarServidor() {
  try {
    await inicializarPersistencia();
    await carregarHistoricosDoBanco();
    await carregarTextosProntos();

    server.listen(PORT, () => {
      console.log(`FoxLog Connect backend ON na porta ${PORT} usando ${storageMode}.`);
    });
  } catch (error) {
    console.error(error.message || "Nao foi possivel iniciar a persistencia.");
    process.exit(1);
  }
}

iniciarServidor();
