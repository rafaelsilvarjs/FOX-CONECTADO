import { useEffect, useState } from "react";
import Login from "./login";
import Home from "./home";
import Atendimento from "./atendimento";
import Disparo from "./disparo";
import Acompanhamento from "./acompanhamento";
import "./app.css";

function App() {
  const [user, setUser] = useState(null);
  const [tela, setTela] = useState("login");
  const [cpfInicialAtendimento, setCpfInicialAtendimento] = useState(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-fox-theme", "night");
    window.localStorage.removeItem("foxlog-theme-mode");
  }, []);

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

  return conteudo;
}

export default App;
