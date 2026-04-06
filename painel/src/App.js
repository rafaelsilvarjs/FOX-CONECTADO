import { useEffect, useState } from "react";
import Login from "./login";
import Home from "./home";
import Atendimento from "./atendimento";
import Disparo from "./disparo";
import Acompanhamento from "./acompanhamento";
import "./app.css";

const SESSION_STORAGE_KEY = "foxlog-painel-session";

function lerSessaoPainel() {
  if (typeof window === "undefined") {
    return { user: null, tela: "login", cpfInicialAtendimento: null };
  }

  try {
    const salva = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) || "{}");
    return {
      user: salva.user || null,
      tela: salva.user ? salva.tela || "home" : "login",
      cpfInicialAtendimento: salva.cpfInicialAtendimento || null
    };
  } catch (_) {
    return { user: null, tela: "login", cpfInicialAtendimento: null };
  }
}

function App() {
  const sessaoInicial = lerSessaoPainel();
  const [user, setUser] = useState(sessaoInicial.user);
  const [tela, setTela] = useState(sessaoInicial.tela);
  const [cpfInicialAtendimento, setCpfInicialAtendimento] = useState(sessaoInicial.cpfInicialAtendimento);

  useEffect(() => {
    document.documentElement.setAttribute("data-fox-theme", "night");
    window.localStorage.removeItem("foxlog-theme-mode");
  }, []);

  useEffect(() => {
    if (!user) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ user, tela, cpfInicialAtendimento })
    );
  }, [user, tela, cpfInicialAtendimento]);

  const sair = () => {
    setUser(null);
    setTela("login");
    setCpfInicialAtendimento(null);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
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
      {user ? (
        <button className="session-action logout-action" type="button" onClick={sair}>
          Sair
        </button>
      ) : null}
    </>
  );
}

export default App;
