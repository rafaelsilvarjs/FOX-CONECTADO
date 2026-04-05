import { useEffect, useState } from "react";
import Login from "./login";
import Home from "./home";
import Atendimento from "./atendimento";
import Disparo from "./disparo";
import Acompanhamento from "./acompanhamento";
import "./app.css";

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
  const [user, setUser] = useState(null);
  const [tela, setTela] = useState("login");
  const [cpfInicialAtendimento, setCpfInicialAtendimento] = useState(null);
  const [theme, setTheme] = useState(obterTemaInicial);

  useEffect(() => {
    document.documentElement.setAttribute("data-fox-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const alternarTema = () => {
    setTheme((atual) => (atual === "night" ? "day" : "night"));
  };

  let conteudo = null;

  if (!user) {
    conteudo = <Login setUser={setUser} setTela={setTela} />;
  } else if (tela === "home") {
    conteudo = <Home user={user} setTela={setTela} />;
  } else if (tela === "atendimento") {
    conteudo = (
      <Atendimento
        user={user}
        cpfInicial={cpfInicialAtendimento}
        onBack={() => setTela("home")}
        onGoToDisparo={() => setTela("disparo")}
      />
    );
  } else if (tela === "disparo") {
    conteudo = (
      <Disparo
        user={user}
        onBack={() => setTela("home")}
        onGoToAtendimento={() => setTela("atendimento")}
      />
    );
  } else if (tela === "acompanhamento" && user.role === "admin") {
    conteudo = (
      <Acompanhamento
        user={user}
        onBack={() => setTela("home")}
        onGoToAtendimento={(cpf) => {
          setCpfInicialAtendimento(cpf);
          setTela("atendimento");
        }}
      />
    );
  } else {
    conteudo = <Home user={user} setTela={setTela} />;
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
