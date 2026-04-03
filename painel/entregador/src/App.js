import { useState } from "react";
import Login from "./login";
import Menu from "./menu";
import Chat from "./chat";
import Performance from "./performance";
import "./App.css";

function App() {
  const [entregador, setEntregador] = useState(null);
  const [tela, setTela] = useState("login");

  if (!entregador) {
    return <Login setEntregador={setEntregador} setTela={setTela} />;
  }

  if (tela === "menu") {
    return <Menu entregador={entregador} setTela={setTela} />;
  }

  if (tela === "chat") {
    return <Chat entregador={entregador} onBack={() => setTela("menu")} />;
  }

  if (tela === "performance") {
    return <Performance entregador={entregador} onBack={() => setTela("menu")} />;
  }

  return null;
}

export default App;
