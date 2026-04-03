function Home({ user, setTela }) {
  const logoUrl = `${process.env.PUBLIC_URL}/logo192.png`;
  const tituloPerfil =
    user.role === "admin" ? "Administrador" : user.role === "operacao" ? "Operacao" : "Atendente";

  return (
    <div className="home-page">
      <img className="fox-watermark" src={logoUrl} alt="" aria-hidden="true" />
      <div className="home-card">
        <div className="brand with-logo">
          <img className="brand-logo" src={logoUrl} alt="FoxLog" />
          <div>
            <strong>FoxLog Connect</strong>
            <span>{`${tituloPerfil}: ${user.nome}`}</span>
          </div>
        </div>

        <div className="home-grid">
          <button className="secondary-button" onClick={() => setTela("atendimento")}>
            Abrir atendimento
          </button>

          <button className="secondary-button" onClick={() => setTela("disparo")}>
            Abrir disparo em massa
          </button>

          {user.role === "admin" ? (
            <button className="secondary-button" onClick={() => setTela("acompanhamento")}>
              Abrir acompanhamento admin
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Home;
