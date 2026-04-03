import { useState } from "react";
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

  if (!user) {
    return <Login setUser={setUser} setTela={setTela} />;
  }

  if (tela === "home") {
    return <Home user={user} setTela={setTela} />;
  }

  if (tela === "atendimento") {
    return (
      <Atendimento
        user={user}
        cpfInicial={cpfInicialAtendimento}
        onBack={() => setTela("home")}
        onGoToDisparo={() => setTela("disparo")}
      />
    );
  }

  if (tela === "disparo") {
    return (
      <Disparo
        user={user}
        onBack={() => setTela("home")}
        onGoToAtendimento={() => setTela("atendimento")}
      />
    );
  }

  if (tela === "acompanhamento" && user.role === "admin") {
    return (
      <Acompanhamento
        user={user}
        onBack={() => setTela("home")}
        onGoToAtendimento={(cpf) => {
          setCpfInicialAtendimento(cpf);
          setTela("atendimento");
        }}
      />
    );
  }

  return <Home user={user} setTela={setTela} />;
}

export default App;
