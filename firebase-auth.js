// firebase-auth.js — ponte entre o script.js e o Firebase
(function () {
  function aguardarFirebase(cb) {
    if (window.BimerFirebase) return cb(window.BimerFirebase);
    let tentativas = 0;
    const t = setInterval(() => {
      if (window.BimerFirebase) { clearInterval(t); cb(window.BimerFirebase); }
      else if (++tentativas > 100) { clearInterval(t); console.error("Firebase não inicializou."); }
    }, 50);
  }

  const api = {
    login(email, senha) {
      return window.BimerFirebase.signInWithEmailAndPassword(
        window.BimerFirebase.auth, email, senha
      );
    },
    logout() {
      return window.BimerFirebase.signOut(window.BimerFirebase.auth);
    },
    aoMudarLogin(cb) {
      aguardarFirebase((fb) => fb.onAuthStateChanged(fb.auth, cb));
    },
    usuarioAtual() {
      return window.BimerFirebase?.auth?.currentUser || null;
    },

    async lerSaldos() {
      await new Promise((res) => aguardarFirebase(res));
      const fb = window.BimerFirebase;
      const snap = await fb.getDoc(fb.SALDOS_REF);
      if (!snap.exists()) return null;
      const d = snap.data();
      return {
        contas: Array.isArray(d.contas) ? d.contas : [],
        atualizadoEm: d.atualizadoEm || null,
      };
    },
    async salvarSaldos(saldoData) {
      await new Promise((res) => aguardarFirebase(res));
      const fb = window.BimerFirebase;
      await fb.setDoc(fb.SALDOS_REF, {
        contas: saldoData.contas,
        atualizadoEm: saldoData.atualizadoEm,
      });
      return true;
    },
  };

  window.BimerAuth = api;
})();