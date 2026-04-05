import { useEffect, useState } from "react";
import Login from "./login";
import Menu from "./menu";
import Chat from "./chat";
import Performance from "./performance";
import "./App.css";

const THEME_STORAGE_KEY = "foxlog-theme-mode";

function obterTemaInicial() {
  if (typeof window !== "undefined") {
    const salvo = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (salvo === "day" || salvo === "night") {
      return salvo;
    }
  }

  const horaAtual = new Date().getHours();
  return horaAtual >= 6 && horaAtual < 18 ? "day" : "night";
}

function App() {
  const [entregador, setEntregador] = useState(null);
  const [tela, setTela] = useState("login");
  const [theme, setTheme] = useState(obterTemaInicial);

  useEffect(() => {
    document.documentElement.setAttribute("data-fox-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const alternarTema = () => {
    setTheme((atual) => (atual === "night" ? "day" : "night"));
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
      <button className="theme-toggle" type="button" onClick={alternarTema}>
        {theme === "night" ? "Modo diurno" : "Modo noturno"}
      </button>
    </>
  );
}

export default App;
