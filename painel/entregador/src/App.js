import { useEffect, useState } from "react";
import Login from "./login";
import Menu from "./menu";
import Chat from "./chat";
import Performance from "./performance";
import "./App.css";

const THEME_STORAGE_KEY = "foxlog-theme-mode";
const SESSION_STORAGE_KEY = "foxlog-entregador-session";

function obterTemaInicial() {
  if (typeof window !== "undefined") {
    const salvo = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (salvo === "day" || salvo === "night") {
      return salvo;
    }
  }

  return "night";
}

function lerSessaoEntregador() {
  if (typeof window === "undefined") {
    return { entregador: null, tela: "login" };
  }

  try {
    const salva = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
    return {
      entregador: salva.entregador || null,
      tela: salva.entregador ? salva.tela || "menu" : "login"
    };
  } catch (_) {
    return { entregador: null, tela: "login" };
  }
}

function App() {
  const sessaoInicial = lerSessaoEntregador();
  const [entregador, setEntregador] = useState(sessaoInicial.entregador);
  const [tela, setTela] = useState(sessaoInicial.tela);
  const [theme, setTheme] = useState(obterTemaInicial);

  useEffect(() => {
    document.documentElement.setAttribute("data-fox-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (entregador) {
      setTheme("night");
    }
  }, [entregador]);

  useEffect(() => {
    if (!entregador) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ entregador, tela })
    );
  }, [entregador, tela]);

  const alternarTema = () => {
    setTheme((atual) => (atual === "night" ? "day" : "night"));
  };

  const sair = () => {
    setEntregador(null);
    setTela("login");
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  };

  let conteudo = null;

  if (!entregador) {
    conteudo = <Login setEntregador={setEntregador} setTela={setTela} />;
  } else if (tela === "menu") {
    conteudo = <Menu entregador={entregador} setTela={setTela} />;
  } else if (tela === "chat") {
    conteudo = <Chat entregador={entregador} onBack={() => setTela("menu")} />;
  } else if (tela === "performance") {
    conteudo = <Performance entregador={entregador} onBack={() => setTela("menu")} />;
  }

  return (
    <>
      {conteudo}
      {entregador ? (
        <button className="session-action logout-action" type="button" onClick={sair}>
          Sair
        </button>
      ) : null}
      {!entregador ? (
        <button className="theme-toggle" type="button" onClick={alternarTema}>
          {theme === "night" ? "Modo diurno" : "Modo noturno"}
        </button>
      ) : null}
    </>
  );
}

export default App;
