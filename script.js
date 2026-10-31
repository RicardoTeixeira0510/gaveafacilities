(function(){
        // ----- ESTADO -----
        let registros = [];
        let colMap = {};
        let pendingNegateIds = [];
        let flatpickrInstance = null;
        let selecionados = new Set();
        let ultimosFiltrados = [];

        const FILTROS_CONFIG = [
            { campo: 'empresa', getValor: r => r.empresa },
            { campo: 'pessoa', getValor: r => r.nomePessoa },
            { campo: 'natureza', getValor: r => r.natureza },
            { campo: 'centroCusto', getValor: r => r.centroCusto },
        ];
        let filtrosSelecionados = {
            empresa: new Set(),
            pessoa: new Set(),
            natureza: new Set(),
            centroCusto: new Set(),
        };

        const tbody = document.getElementById('table-body');
        const tabela = tbody.closest('table');
        const theadCells = tabela ? Array.from(tabela.querySelectorAll('thead th')) : [];
        let largurasColunasFixadas = false;
        const fileInput = document.getElementById('file-input');
        const fileStatus = document.getElementById('file-status');
        const qtdRegistros = document.getElementById('qtdRegistros');
        const totalGeralAbertoEl = document.getElementById('totalGeralAberto');
        const totalAprovadoEl = document.getElementById('totalAprovado');
        const totalAtrasoValorEl = document.getElementById('totalAtrasoValor');
        const qtdAtrasoInfoEl = document.getElementById('qtdAtrasoInfo');
        const totalFiltradoBar = document.getElementById('totalFiltradoBar');
        const totalFiltradoValorEl = document.getElementById('totalFiltradoValor');
        const qtdFiltradosBadgeEl = document.getElementById('qtdFiltradosBadge');
        const limparTodosFiltrosBtn = document.getElementById('limparTodosFiltros');
        const tabsBar = document.getElementById('tabsBar');
        let abaAtual = 'Pendente';

        const selecionarTodosCheckbox = document.getElementById('selecionarTodos');
        const selecionarTodosMobileCheckbox = document.getElementById('selecionarTodosMobile');
        const bulkBar = document.getElementById('bulkBar');
        const bulkCount = document.getElementById('bulkCount');
        const bulkAprovar = document.getElementById('bulkAprovar');
        const bulkNegar = document.getElementById('bulkNegar');
        const bulkAnalise = document.getElementById('bulkAnalise');
        const bulkLimpar = document.getElementById('bulkLimpar');

        const obsModal = document.getElementById('obsModal');
        const obsTexto = document.getElementById('obs-texto');
        const fecharObs = document.getElementById('fechar-obs');

        const dataModal = document.getElementById('dataModal');
        const novaDataInput = document.getElementById('novaDataInput');
        const confirmarData = document.getElementById('confirmarData');
        const cancelarData = document.getElementById('cancelarData');
        const avisoFimSemana = document.getElementById('avisoFimSemana');

        // ----- helpers -----
        function getVal(row, label) {
            const chave = colMap[label];
            if (chave === undefined) return '';
            const val = row[chave] !== undefined ? row[chave] : '';
            return String(val).trim();
        }

        function formatarValor(valor) {
            const positivo = Math.abs(valor);
            return 'R$ ' + positivo.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        }

        function atualizarTotais() {
            const totalGeral = registros.reduce((soma, r) => soma + Math.abs(r.vlAberto || 0), 0);
            const totalAprovado = registros
                .filter(r => r.status === 'Aprovado')
                .reduce((soma, r) => soma + Math.abs(r.vlAberto || 0), 0);

            totalGeralAbertoEl.textContent = formatarValor(totalGeral);
            totalAprovadoEl.textContent = formatarValor(totalAprovado);

            const atrasados = registros.filter(r => r.atrasoDias !== null && r.atrasoDias !== undefined && r.atrasoDias > 0);
            const totalAtraso = atrasados.reduce((soma, r) => soma + Math.abs(r.vlAberto || 0), 0);
            if (totalAtrasoValorEl) totalAtrasoValorEl.textContent = formatarValor(totalAtraso);
            if (qtdAtrasoInfoEl) qtdAtrasoInfoEl.textContent = `${atrasados.length} título${atrasados.length === 1 ? '' : 's'} em atraso`;

            atualizarSaldoCard(totalAprovado);
        }

        function atualizarContadoresAbas() {
            const cont = { 'Pendente': 0, 'Em análise': 0, 'Aprovado': 0, 'Negado': 0 };
            registros.forEach(r => {
                if (cont[r.status] !== undefined) cont[r.status]++;
            });
            document.getElementById('count-Pendente').textContent = cont['Pendente'];
            document.getElementById('count-Em análise').textContent = cont['Em análise'];
            document.getElementById('count-Aprovado').textContent = cont['Aprovado'];
            document.getElementById('count-Negado').textContent = cont['Negado'];
            document.getElementById('count-Todos').textContent = registros.length;
        }

        function trocarAba(novoStatus) {
            abaAtual = novoStatus;
            document.querySelectorAll('.tab-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.status === novoStatus);
            });
            renderTable();
        }

        function atualizarTotalFiltrado(filtered) {
            if (!totalFiltradoBar) return;
            if (registros.length === 0) {
                totalFiltradoBar.classList.remove('active');
                return;
            }
            totalFiltradoBar.classList.add('active');
            const total = filtered.reduce((soma, r) => soma + Math.abs(r.vlAberto || 0), 0);
            totalFiltradoValorEl.textContent = formatarValor(total);
            qtdFiltradosBadgeEl.textContent = `(${filtered.length} título${filtered.length === 1 ? '' : 's'})`;
        }

        function escAttr(str) {
            return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        }

        function popularFiltros() {
            FILTROS_CONFIG.forEach(({ campo, getValor }) => {
                filtrosSelecionados[campo] = new Set();

                const contagem = new Map();
                registros.forEach(r => {
                    const valor = getValor(r) || 'N/A';
                    contagem.set(valor, (contagem.get(valor) || 0) + 1);
                });

                const valoresOrdenados = Array.from(contagem.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR'));

                const container = document.getElementById(`filtro-${campo}-opcoes`);
                if (container) {
                    container.innerHTML = valoresOrdenados.length === 0
                        ? '<p class="filtro-vazio">Nenhum valor encontrado</p>'
                        : valoresOrdenados.map(valor => `
                            <label class="filtro-opcao">
                                <input type="checkbox" value="${escAttr(valor)}">
                                <span class="filtro-opcao-texto">${escHtml(valor)}</span>
                                <span class="filtro-opcao-count">${contagem.get(valor)}</span>
                            </label>
                        `).join('');
                }

                const busca = document.getElementById(`filtro-${campo}-busca`);
                if (busca) busca.value = '';

                atualizarBadgeFiltro(campo);
            });
        }

        function atualizarBadgeFiltro(campo) {
            const qtd = filtrosSelecionados[campo].size;
            const badge = document.getElementById(`filtro-${campo}-badge`);
            const dropdown = document.querySelector(`.filtro-dropdown[data-campo="${campo}"]`);
            if (badge) badge.textContent = qtd;
            if (dropdown) dropdown.classList.toggle('filtro-ativo', qtd > 0);
            atualizarVisibilidadeLimparTodos();
        }

        function atualizarVisibilidadeLimparTodos() {
            if (!limparTodosFiltrosBtn) return;
            const algumAtivo = FILTROS_CONFIG.some(({ campo }) => filtrosSelecionados[campo].size > 0);
            limparTodosFiltrosBtn.style.display = algumAtivo ? 'inline-flex' : 'none';
        }

        function parseDataBr(dataStr) {
            if (!dataStr) return null;
            const partes = String(dataStr).trim().split('/');
            if (partes.length !== 3) return null;
            const dia = parseInt(partes[0]);
            const mes = parseInt(partes[1]) - 1;
            const ano = parseInt(partes[2]);
            if (isNaN(dia) || isNaN(mes) || isNaN(ano)) return null;
            const data = new Date(ano, mes, dia);
            if (data.getFullYear() !== ano || data.getMonth() !== mes || data.getDate() !== dia) return null;
            return data;
        }

        function isFimDeSemana(dataStr) {
            if (!dataStr) return false;
            const partes = dataStr.split('/');
            if (partes.length !== 3) return false;
            const dia = parseInt(partes[0]);
            const mes = parseInt(partes[1]) - 1;
            const ano = parseInt(partes[2]);
            if (isNaN(dia) || isNaN(mes) || isNaN(ano)) return false;
            const data = new Date(ano, mes, dia);
            const diaSemana = data.getDay();
            return diaSemana === 0 || diaSemana === 6;
        }

        function formatarDataParaExibicao(dataStr) {
            if (!dataStr) return '—';
            dataStr = String(dataStr).trim();
            dataStr = dataStr.split(' ')[0];
            if (dataStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) return dataStr;
            const partes = dataStr.split('-');
            if (partes.length === 3 && partes[0].length === 4) {
                return `${partes[2]}/${partes[1]}/${partes[0]}`;
            }
            return dataStr;
        }

        function proximoDiaUtil(dataBase) {
            const data = dataBase ? new Date(dataBase) : new Date();
            data.setDate(data.getDate() + 1);
            while (data.getDay() === 0 || data.getDay() === 6) {
                data.setDate(data.getDate() + 1);
            }
            const dia = String(data.getDate()).padStart(2, '0');
            const mes = String(data.getMonth() + 1).padStart(2, '0');
            const ano = data.getFullYear();
            return `${dia}/${mes}/${ano}`;
        }

        function aplicarMascaraData(input) {
            let valor = input.value.replace(/\D/g, '');
            if (valor.length > 8) valor = valor.slice(0, 8);
            let formatado = '';
            for (let i = 0; i < valor.length; i++) {
                if (i === 2 || i === 4) {
                    formatado += '/';
                }
                formatado += valor[i];
            }
            input.value = formatado;
        }

        function loadWorkbook(data, nomeArquivo) {
            try {
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(firstSheet, { defval: '', blankrows: false });
                const jsonTextual = XLSX.utils.sheet_to_json(firstSheet, { defval: '', blankrows: false, raw: false });

                console.log('Total de linhas lidas:', json.length);

                if (!json || json.length === 0) {
                    alert('A planilha está vazia ou não possui cabeçalho.');
                    return;
                }

                const headers = Object.keys(json[0]);
                colMap = {};
                headers.forEach((h) => {
                    const cleanHeader = h.replace(/[:：]/g, '').trim();
                    colMap[cleanHeader] = h;
                });

                console.log('Colunas encontradas:', Object.keys(colMap));

                const required = ['Nome da pessoa', 'Empresa', 'Natureza de lançamento', 'Centro(s) de custo', 'Vl. título (atualizado)', 'Vl. em aberto', 'Dt. venc. programado'];
                const missing = required.filter(r => !(r in colMap));
                if (missing.length) {
                    alert(`Colunas obrigatórias não encontradas: ${missing.join(', ')}\n\nColunas disponíveis: ${Object.keys(colMap).join(', ')}`);
                    return;
                }

                const linhasValidas = json
                    .map((row, i) => ({ row, textRow: jsonTextual[i] || {} }))
                    .filter(({ row }) => {
                        const nome = getVal(row, 'Nome da pessoa');
                        const empresa = getVal(row, 'Empresa');
                        return nome || empresa;
                    });

                console.log('Linhas válidas encontradas:', linhasValidas.length);

                if (linhasValidas.length === 0) {
                    alert('Nenhuma linha com dados válidos encontrada. Verifique se a planilha tem os cabeçalhos corretos.');
                    return;
                }

                registros = linhasValidas.map(({ row, textRow }, idx) => {
                    const get = (label) => {
                        const cleanLabel = label.replace(/[:：]/g, '').trim();
                        return getVal(row, cleanLabel);
                    };

                    const vlTituloStr = get('Vl. título (atualizado)');
                    let vlTitulo = 0;
                    try { vlTitulo = parseFloat(vlTituloStr) || 0; } catch(e) { vlTitulo = 0; }

                    const vlAbertoStr = get('Vl. em aberto');
                    let vlAberto = 0;
                    try { vlAberto = parseFloat(vlAbertoStr) || 0; } catch(e) { vlAberto = 0; }

                    const chaveDtVenc = colMap['Dt. venc. programado'];
                    const dtVencTexto = chaveDtVenc !== undefined ? String(textRow[chaveDtVenc] ?? '').trim() : '';
                    const dtVencimento = formatarDataParaExibicao(dtVencTexto) || dtVencTexto;

                    const chaveDtVencOriginal = colMap['Dt. venc. original'];
                    const dtVencOriginalTexto = chaveDtVencOriginal !== undefined ? String(textRow[chaveDtVencOriginal] ?? '').trim() : '';
                    const dtVencOriginal = dtVencOriginalTexto ? (formatarDataParaExibicao(dtVencOriginalTexto) || dtVencOriginalTexto) : '';

                    let atrasoDias = null;
                    const dataOriginalObj = parseDataBr(dtVencOriginal);
                    const dataProgramadaObj = parseDataBr(dtVencimento);
                    if (dataOriginalObj && dataProgramadaObj) {
                        atrasoDias = Math.round((dataProgramadaObj - dataOriginalObj) / 86400000);
                    }

                    const chavePix = get('Chave PIX (a pagar)');
                    const nrAgencia = get('Nr. agência');
                    const ccFornecedor = get('C/C fornecedor (a pagar)');
                    const linhasDadosPagamento = [];
                    if (chavePix) linhasDadosPagamento.push(`PIX: ${chavePix}`);
                    if (nrAgencia) linhasDadosPagamento.push(`AG: ${nrAgencia}`);
                    if (ccFornecedor) linhasDadosPagamento.push(`C/C: ${ccFornecedor}`);
                    const dadosPagamento = linhasDadosPagamento.join('\n');

                    return {
                        id: idx,
                        empresa: get('Empresa') || 'N/A',
                        nomePessoa: get('Nome da pessoa') || 'N/A',
                        nrTitulo: get('Nr. título') || '',
                        dtVencimento: dtVencimento || '—',
                        dtVencOriginal: dtVencOriginal || '',
                        atrasoDias: atrasoDias,
                        natureza: get('Natureza de lançamento') || 'N/A',
                        centroCusto: get('Centro(s) de custo') || 'N/A',
                        vlTitulo: vlTitulo,
                        vlAberto: vlAberto,
                        observacao: get('Observação') || '',
                        status: 'Pendente',
                        novoVencimento: '',
                        formaPagamento: get('Forma de pagamento') || '',
                        usuarioCadastro: get('Usuário (cadastro)') || '',
                        dadosPagamento: dadosPagamento,
                    };
                });

                console.log('Registros processados:', registros.length);

                selecionados.clear();
                destravarLargurasColunas();
                popularFiltros();
                fileStatus.textContent = `✅ ${nomeArquivo || 'planilha'}`;
                qtdRegistros.textContent = `${registros.length} registros`;
                renderTable();
                travarLargurasColunas();

            } catch (error) {
                console.error('Erro ao ler planilha:', error);
                alert('Erro ao ler a planilha: ' + error.message);
            }
        }

        function travarLargurasColunas() {}
        function destravarLargurasColunas() {}

        function renderTable() {
            atualizarTotais();
            atualizarContadoresAbas();

            let filtered = registros.filter(r => {
                if (filtrosSelecionados.empresa.size && !filtrosSelecionados.empresa.has(r.empresa)) return false;
                if (filtrosSelecionados.pessoa.size && !filtrosSelecionados.pessoa.has(r.nomePessoa)) return false;
                if (filtrosSelecionados.natureza.size && !filtrosSelecionados.natureza.has(r.natureza)) return false;
                if (filtrosSelecionados.centroCusto.size && !filtrosSelecionados.centroCusto.has(r.centroCusto)) return false;
                if (abaAtual && r.status !== abaAtual) return false;
                return true;
            });
            ultimosFiltrados = filtered;
            atualizarTotalFiltrado(filtered);

            if (registros.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="12" class="td-full">
                                <i class="fas fa-file-upload"></i>
                                <p>Carregue uma planilha para começar</p>
                                <p style="font-size:13px; margin-top:8px; color:#8aa3c0;">Clique em "Importar planilha" para selecionar o arquivo</p>
                            </div>
                        </td>
                    </tr>
                `;
                atualizarBarraSelecao();
                return;
            }

            if (filtered.length === 0) {
                const nomeAba = abaAtual || 'Todos';
                tbody.innerHTML = `<tr><td colspan="12" class="td-full" style="text-align:center; padding:24px; color:#6e8aaa;">Nenhum registro em "${escHtml(nomeAba)}" com esses filtros</td></tr>`;
                atualizarBarraSelecao();
                return;
            }

            let html = '';
            filtered.forEach((r) => {
                const statusClass = r.status === 'Aprovado' ? 'status-aprovado' :
                                   r.status === 'Negado' ? 'status-negado' :
                                   r.status === 'Em análise' ? 'status-analise' : '';
                const statusLabel = r.status || 'Pendente';
                const valorFormatado = formatarValor(r.vlAberto);
                const obsPreview = r.observacao.length > 30 ? r.observacao.slice(0, 30)+'…' : r.observacao;
                const dataExibicao = formatarDataParaExibicao(r.novoVencimento);

                let atrasoHtml = '';
                if (r.atrasoDias !== null && r.atrasoDias !== undefined) {
                    if (r.atrasoDias > 0) {
                        let nivel = 'atraso-baixo';
                        let rotulo = 'Atraso leve';
                        if (r.atrasoDias > 30) { nivel = 'atraso-alto'; rotulo = 'Atraso crítico'; }
                        else if (r.atrasoDias > 7) { nivel = 'atraso-medio'; rotulo = 'Atraso moderado'; }
                        atrasoHtml = `<span class="atraso-badge ${nivel}" title="${rotulo}: ${r.atrasoDias} dia(s) além da data original"><i class="fas fa-triangle-exclamation"></i> ${r.atrasoDias} dia${r.atrasoDias === 1 ? '' : 's'} atraso</span>`;
                    } else {
                        atrasoHtml = `<span class="atraso-badge atraso-ok" title="Dentro da data original"><i class="fas fa-check"></i> Em dia</span>`;
                    }
                }
                const vencOriginalHtml = (r.dtVencOriginal && r.dtVencOriginal !== '—')
                    ? `<div class="venc-original">Original: ${escHtml(r.dtVencOriginal)}</div>` : '';

                html += `<tr>
                    <td class="td-checkbox" data-label="Selecionar"><input type="checkbox" class="row-checkbox" data-idx="${r.id}" ${selecionados.has(r.id) ? 'checked' : ''}></td>
                    <td class="badge-empresa" data-label="Empresa" title="${escAttr(r.empresa)}">${escHtml(r.empresa)}</td>
                    <td class="pessoa-cell" data-label="Pessoa" title="${escAttr(r.nomePessoa)}">${escHtml(r.nomePessoa)}</td>
                    <td data-label="Nr. Título">${r.nrTitulo ? `<span class="nr-titulo"><i class="fas fa-hashtag"></i> ${escHtml(r.nrTitulo)}</span>` : '—'}</td>
                    <td data-label="Vencimento">
                        <div class="venc-principal">${escHtml(r.dtVencimento)}</div>
                        ${vencOriginalHtml}
                        ${atrasoHtml}
                    </td>
                    <td class="natureza-cell" data-label="Natureza" title="${escAttr(r.natureza)}">${escHtml(r.natureza)}</td>
                    <td class="centro-cell" data-label="Centro de custo" title="${escAttr(r.centroCusto)}">${escHtml(r.centroCusto)}</td>
                    <td class="valor" data-label="Vl. em aberto">${valorFormatado}</td>
                    <td class="observacao-cell" data-label="Observação">
                        ${obsPreview ? `<button class="btn-pequeno" data-idx="${r.id}"><i class="fas fa-eye"></i> ver</button>` : '—'}
                    </td>
                    <td data-label="Status"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td data-label="Novo venc.">
                        ${(r.status === 'Negado' || r.status === 'Em análise') && r.novoVencimento ? `<span style="font-size:11px; background:#eef3fa; padding:2px 10px; border-radius:30px;">${dataExibicao}</span>` : '—'}
                    </td>
                    <td data-label="Ações">
                        <div class="btn-group">
                            <button class="btn-aprovar" data-idx="${r.id}" title="Aprovar"><i class="fas fa-check"></i> <span class="btn-text">Aprovar</span></button>
                            <button class="btn-negar" data-idx="${r.id}" title="Negar"><i class="fas fa-times"></i> <span class="btn-text">Negar</span></button>
                            <button class="btn-analise" data-idx="${r.id}" title="Análise"><i class="fas fa-clock"></i> <span class="btn-text">Análise</span></button>
                        </div>
                    </td>
                </tr>`;
            });
            tbody.innerHTML = html;

            tbody.querySelectorAll('.btn-aprovar').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    setStatus(idx, 'Aprovado', '');
                });
            });

            tbody.querySelectorAll('.btn-negar').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    abrirModalData(idx);
                });
            });

            tbody.querySelectorAll('.btn-analise').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    setStatus(idx, 'Em análise', proximoDiaUtil());
                });
            });

            tbody.querySelectorAll('.btn-pequeno').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    const reg = registros.find(r => r.id === idx);
                    if (reg) {
                        obsTexto.textContent = reg.observacao || '(sem observação)';
                        obsModal.classList.add('active');
                    }
                });
            });

            tbody.querySelectorAll('.row-checkbox').forEach(chk => {
                chk.addEventListener('change', (e) => {
                    const idx = parseInt(chk.dataset.idx);
                    if (chk.checked) {
                        selecionados.add(idx);
                    } else {
                        selecionados.delete(idx);
                    }
                    atualizarBarraSelecao();
                });
            });

            atualizarBarraSelecao();
        }

        function atualizarBarraSelecao() {
            if (bulkCount) bulkCount.textContent = selecionados.size;
            if (bulkBar) bulkBar.classList.toggle('active', selecionados.size > 0);

            if (ultimosFiltrados.length === 0) {
                setCheckboxState(selecionarTodosCheckbox, false, false);
                setCheckboxState(selecionarTodosMobileCheckbox, false, false);
                return;
            }
            const idsVisiveis = ultimosFiltrados.map(r => r.id);
            const qtdSelecionadosVisiveis = idsVisiveis.filter(id => selecionados.has(id)).length;
            const todosSelecionados = qtdSelecionadosVisiveis === idsVisiveis.length;
            const algunsSelecionados = qtdSelecionadosVisiveis > 0 && qtdSelecionadosVisiveis < idsVisiveis.length;

            setCheckboxState(selecionarTodosCheckbox, todosSelecionados, algunsSelecionados);
            setCheckboxState(selecionarTodosMobileCheckbox, todosSelecionados, algunsSelecionados);
        }

        function setCheckboxState(checkbox, checked, indeterminate) {
            if (!checkbox) return;
            checkbox.checked = checked;
            checkbox.indeterminate = indeterminate;
        }

        function abrirModalData(idOuIds) {
            pendingNegateIds = Array.isArray(idOuIds) ? idOuIds : [idOuIds];
            novaDataInput.value = '';
            avisoFimSemana.classList.remove('active');
            dataModal.classList.add('active');

            const infoQtd = document.getElementById('infoQtdNegacao');
            if (infoQtd) {
                infoQtd.textContent = pendingNegateIds.length > 1
                    ? `Aplicando a ${pendingNegateIds.length} lançamentos selecionados.`
                    : '';
                infoQtd.style.display = pendingNegateIds.length > 1 ? 'block' : 'none';
            }

            setTimeout(() => {
                novaDataInput.focus();
            }, 100);

            if (!flatpickrInstance) {
                flatpickrInstance = flatpickr(novaDataInput, {
                    locale: 'pt',
                    dateFormat: 'd/m/Y',
                    allowInput: true,
                    disableMobile: true,
                    onChange: function(selectedDates, dateStr, instance) {
                        const dataSelecionada = instance.input.value;
                        verificarFimSemana(dataSelecionada);
                    },
                    onClose: function(selectedDates, dateStr, instance) {
                        const dataSelecionada = instance.input.value;
                        if (dataSelecionada) {
                            verificarFimSemana(dataSelecionada);
                        }
                    }
                });
            } else {
                flatpickrInstance.setDate(null);
                flatpickrInstance.input.value = '';
            }
        }

        function verificarFimSemana(dataStr) {
            if (isFimDeSemana(dataStr)) {
                avisoFimSemana.classList.add('active');
                const diaSemana = obterNomeDiaSemana(dataStr);
                avisoFimSemana.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ⚠️ Atenção: Esta data cai em um <strong>${diaSemana}</strong>. Considere alterar para o próximo dia útil.`;
            } else {
                avisoFimSemana.classList.remove('active');
            }
        }

        function obterNomeDiaSemana(dataStr) {
            if (!dataStr) return '';
            const partes = dataStr.split('/');
            if (partes.length !== 3) return '';
            const dia = parseInt(partes[0]);
            const mes = parseInt(partes[1]) - 1;
            const ano = parseInt(partes[2]);
            if (isNaN(dia) || isNaN(mes) || isNaN(ano)) return '';
            const data = new Date(ano, mes, dia);
            const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
            return dias[data.getDay()];
        }

        function fecharModalData() {
            dataModal.classList.remove('active');
            pendingNegateIds = [];
            avisoFimSemana.classList.remove('active');
            if (flatpickrInstance) {
                flatpickrInstance.setDate(null);
                flatpickrInstance.input.value = '';
            }
        }

        function confirmarDataModal() {
            const dataStr = novaDataInput.value.trim();
            if (!dataStr) {
                alert('Por favor, informe uma data de vencimento.');
                return;
            }

            if (!dataStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                alert('Formato inválido. Use DD/MM/AAAA.');
                return;
            }

            const partes = dataStr.split('/');
            const dia = parseInt(partes[0]);
            const mes = parseInt(partes[1]) - 1;
            const ano = parseInt(partes[2]);
            const data = new Date(ano, mes, dia);
            if (data.getFullYear() !== ano || data.getMonth() !== mes || data.getDate() !== dia) {
                alert('Data inválida. Verifique o dia, mês e ano.');
                return;
            }

            if (isFimDeSemana(dataStr)) {
                const diaSemana = obterNomeDiaSemana(dataStr);
                if (!confirm(`⚠️ ATENÇÃO: A data ${dataStr} cai em um ${diaSemana}.\n\nDeseja continuar mesmo assim?`)) {
                    return;
                }
            }

            const invalidos = [];
            pendingNegateIds.forEach(id => {
                const reg = registros.find(r => r.id === id);
                if (!reg) return;
                const dataVencOriginal = parseDataBr(reg.dtVencimento);
                if (dataVencOriginal && data <= dataVencOriginal) {
                    invalidos.push(reg);
                }
            });
            if (invalidos.length) {
                const lista = invalidos.slice(0, 6)
                    .map(r => `• ${r.nomePessoa} — venc. original: ${r.dtVencimento}`)
                    .join('\n');
                const extra = invalidos.length > 6 ? `\n...e mais ${invalidos.length - 6} lançamento(s)` : '';
                alert(`A nova data de vencimento precisa ser posterior à data de vencimento original do título (não pode ser igual nem anterior).\n\nCorrija a data para os lançamentos abaixo:\n${lista}${extra}`);
                return;
            }

            if (pendingNegateIds && pendingNegateIds.length) {
                setStatus(pendingNegateIds, 'Negado', dataStr);
                fecharModalData();
            }
        }

        function aplicarStatusRegistro(reg, novoStatus, novoVenc) {
            reg.status = novoStatus;
            if (novoStatus === 'Negado' || novoStatus === 'Em análise') {
                reg.novoVencimento = novoVenc || '';
            } else {
                reg.novoVencimento = '';
            }
        }

        function setStatus(idOuIds, novoStatus, novoVenc) {
            const ids = Array.isArray(idOuIds) ? idOuIds : [idOuIds];
            ids.forEach(id => {
                const reg = registros.find(r => r.id === id);
                if (reg) aplicarStatusRegistro(reg, novoStatus, novoVenc);
            });
            ids.forEach(id => selecionados.delete(id));
            renderTable();
        }

        function escHtml(str) {
            if (!str) return '';
            return String(str).replace(/[&<>"]/g, function(m) {
                if (m === '&') return '&amp;';
                if (m === '<') return '&lt;';
                if (m === '>') return '&gt;';
                if (m === '"') return '&quot;';
                return m;
            });
        }

        // ----- EXCEL -----
        document.getElementById('gerar-excel').addEventListener('click', async function() {
            if (registros.length === 0) {
                alert('Carregue uma planilha antes de gerar o Excel.');
                return;
            }

            const pendentesExcel = registros.filter(r => r.status === 'Pendente');
            if (pendentesExcel.length > 0) {
                alert(`Ainda há ${pendentesExcel.length} pagamento(s) como "Pendente".\n\nAprove, negue ou coloque em análise todos os títulos antes de gerar o Excel.`);
                trocarAba('Pendente');
                return;
            }

            const btn = this;
            const textoOriginal = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gerando...';

            try {
                const workbook = new ExcelJS.Workbook();
                workbook.creator = 'BIMER · Gestor de Aprovação';
                workbook.created = new Date();

                const coresStatus = {
                    'Aprovado':   { fundo: 'FFDCF3E6', texto: 'FF0A4B2A' },
                    'Negado':     { fundo: 'FFF8D4D4', texto: 'FF7F2A2A' },
                    'Em análise': { fundo: 'FFFFEDC9', texto: 'FF7F5E1A' },
                    'Pendente':   { fundo: 'FFE2E9F2', texto: 'FF1A344D' },
                };
                const corAzulHeader = 'FF1D4B77';
                const bordaFina = { style: 'thin', color: { argb: 'FFB7C4D6' } };

                const sheet = workbook.addWorksheet('Relatório', {
                    views: [{ state: 'frozen', ySplit: 1 }],
                    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
                });

                sheet.columns = [
                    { header: 'Empresa', key: 'empresa', width: 26 },
                    { header: 'Pessoa', key: 'nomePessoa', width: 26 },
                    { header: 'Nr. Título', key: 'nrTitulo', width: 14 },
                    { header: 'Dt. Vencimento', key: 'dtVencimento', width: 15 },
                    { header: 'Natureza', key: 'natureza', width: 24 },
                    { header: 'Centro de Custo', key: 'centroCusto', width: 24 },
                    { header: 'Vl. Título', key: 'vlTitulo', width: 15 },
                    { header: 'Vl. em Aberto', key: 'vlAberto', width: 15 },
                    { header: 'Status', key: 'status', width: 15 },
                    { header: 'Novo Vencimento', key: 'novoVencimento', width: 17 },
                    { header: 'Forma de Pagamento', key: 'formaPagamento', width: 20 },
                    { header: 'Dados de Pagamento', key: 'dadosPagamento', width: 30 },
                    { header: 'Usuário (Cadastro)', key: 'usuarioCadastro', width: 20 },
                    { header: 'Observação', key: 'observacao', width: 42 },
                ];

                const headerRow = sheet.getRow(1);
                headerRow.height = 24;
                headerRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: corAzulHeader } };
                    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    cell.border = { top: bordaFina, left: bordaFina, right: bordaFina, bottom: bordaFina };
                });

                registros.forEach((r) => {
                    const valorAberto = Math.abs(r.vlAberto ?? r.vlTitulo ?? 0);
                    const row = sheet.addRow({
                        empresa: r.empresa,
                        nomePessoa: r.nomePessoa,
                        nrTitulo: r.nrTitulo || '—',
                        dtVencimento: r.dtVencimento,
                        natureza: r.natureza,
                        centroCusto: r.centroCusto,
                        vlTitulo: Math.abs(r.vlTitulo || 0),
                        vlAberto: valorAberto,
                        status: r.status,
                        novoVencimento: (r.status === 'Negado' || r.status === 'Em análise') ? (formatarDataParaExibicao(r.novoVencimento) || '') : '',
                        observacao: r.observacao || '',
                        formaPagamento: r.formaPagamento || '',
                        usuarioCadastro: r.usuarioCadastro || '',
                        dadosPagamento: r.dadosPagamento || '',
                    });

                    row.eachCell((cell) => {
                        cell.border = { top: bordaFina, left: bordaFina, right: bordaFina, bottom: bordaFina };
                        cell.alignment = { vertical: 'middle', wrapText: false };
                    });

                    if (r.dadosPagamento) {
                        row.getCell('dadosPagamento').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                        const qtdLinhas = r.dadosPagamento.split('\n').length;
                        if (qtdLinhas > 1) {
                            row.height = Math.max(row.height || 20, qtdLinhas * 14);
                        }
                    }

                    row.getCell('vlTitulo').numFmt = '"R$" #,##0.00';
                    row.getCell('vlAberto').numFmt = '"R$" #,##0.00';
                    row.getCell('vlTitulo').alignment = { vertical: 'middle', horizontal: 'right' };
                    row.getCell('vlAberto').alignment = { vertical: 'middle', horizontal: 'right' };
                    row.getCell('dtVencimento').alignment = { vertical: 'middle', horizontal: 'center' };
                    row.getCell('novoVencimento').alignment = { vertical: 'middle', horizontal: 'center' };

                    const cor = coresStatus[r.status] || coresStatus['Pendente'];
                    const statusCell = row.getCell('status');
                    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.fundo } };
                    statusCell.font = { color: { argb: cor.texto }, bold: true };
                    statusCell.alignment = { vertical: 'middle', horizontal: 'center' };
                });

                sheet.autoFilter = { from: 'A1', to: 'N1' };

                const resumo = workbook.addWorksheet('Resumo');
                resumo.columns = [
                    { header: 'Status', key: 'status', width: 20 },
                    { header: 'Quantidade', key: 'qtd', width: 15 },
                    { header: 'Valor Total (em aberto)', key: 'valor', width: 24 },
                ];
                resumo.getRow(1).eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: corAzulHeader } };
                    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.border = { top: bordaFina, left: bordaFina, right: bordaFina, bottom: bordaFina };
                });
                resumo.getRow(1).height = 22;

                const statusOrdem = ['Pendente', 'Aprovado', 'Negado', 'Em análise'];
                statusOrdem.forEach((st) => {
                    const itens = registros.filter((r) => r.status === st);
                    if (itens.length === 0) return;
                    const total = itens.reduce((s, r) => s + Math.abs(r.vlAberto ?? r.vlTitulo ?? 0), 0);
                    const row = resumo.addRow({ status: st, qtd: itens.length, valor: total });
                    row.getCell('valor').numFmt = '"R$" #,##0.00';
                    row.getCell('valor').alignment = { horizontal: 'right' };
                    row.getCell('qtd').alignment = { horizontal: 'center' };
                    const cor = coresStatus[st];
                    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.fundo } };
                    row.getCell('status').font = { color: { argb: cor.texto }, bold: true };
                    row.eachCell((cell) => {
                        cell.border = { top: bordaFina, left: bordaFina, right: bordaFina, bottom: bordaFina };
                    });
                });

                const totalGeralLinha = resumo.addRow({
                    status: 'TOTAL GERAL',
                    qtd: registros.length,
                    valor: registros.reduce((s, r) => s + Math.abs(r.vlAberto ?? r.vlTitulo ?? 0), 0),
                });
                totalGeralLinha.font = { bold: true };
                totalGeralLinha.getCell('valor').numFmt = '"R$" #,##0.00';
                totalGeralLinha.getCell('valor').alignment = { horizontal: 'right' };
                totalGeralLinha.getCell('qtd').alignment = { horizontal: 'center' };
                totalGeralLinha.eachCell((cell) => {
                    cell.border = { top: { style: 'medium', color: { argb: 'FF1D4B77' } }, left: bordaFina, right: bordaFina, bottom: bordaFina };
                });

                const buffer = await workbook.xlsx.writeBuffer();
                const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                const blob = new Blob([buffer], { type: mimeType });
                const dataArquivo = new Date().toISOString().slice(0, 10);
                const nomeArquivo = `relatorio_aprovacao_bimer_${dataArquivo}.xlsx`;

                baixarExcelGerado(blob, nomeArquivo);
            } catch (error) {
                console.error('Erro ao gerar Excel:', error);
                alert('Erro ao gerar o Excel: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        });

        function baixarExcelGerado(blob, nomeArquivo) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nomeArquivo;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // ----- Eventos -----

        function handleFile(file) {
            if (!file) return;
            const extensoesValidas = /\.(xls|xlsx|csv)$/i;
            if (!extensoesValidas.test(file.name)) {
                alert('Formato de arquivo não suportado. Envie um arquivo .xls, .xlsx ou .csv.');
                return;
            }
            const reader = new FileReader();
            reader.onload = function(ev) {
                const data = new Uint8Array(ev.target.result);
                loadWorkbook(data, file.name);
            };
            reader.readAsArrayBuffer(file);
        }

        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            handleFile(file);
        });

        const uploadArea = document.getElementById('upload-area');

        ['dragenter', 'dragover'].forEach((evento) => {
            uploadArea.addEventListener(evento, function(e) {
                e.preventDefault();
                e.stopPropagation();
                uploadArea.classList.add('drag-over');
            });
        });

        ['dragleave', 'dragend'].forEach((evento) => {
            uploadArea.addEventListener(evento, function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!uploadArea.contains(e.relatedTarget)) {
                    uploadArea.classList.remove('drag-over');
                }
            });
        });

        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            uploadArea.classList.remove('drag-over');
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            handleFile(file);
        });

        novaDataInput.addEventListener('input', function(e) {
            aplicarMascaraData(this);
            if (this.value.length === 10) {
                verificarFimSemana(this.value);
            }
        });

        novaDataInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                confirmarDataModal();
            }
        });

        confirmarData.addEventListener('click', confirmarDataModal);
        cancelarData.addEventListener('click', fecharModalData);

        dataModal.addEventListener('click', function(e) {
            if (e.target === this) {
                fecharModalData();
            }
        });

        fecharObs.addEventListener('click', () => {
            obsModal.classList.remove('active');
        });
        obsModal.addEventListener('click', (e) => {
            if (e.target === obsModal) obsModal.classList.remove('active');
        });

        // ----- Filtros de múltipla seleção -----

        document.querySelectorAll('.filtro-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const dropdown = btn.closest('.filtro-dropdown');
                const estavaAberto = dropdown.classList.contains('open');
                document.querySelectorAll('.filtro-dropdown.open').forEach(d => d.classList.remove('open'));
                if (!estavaAberto) dropdown.classList.add('open');
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.filtro-dropdown')) {
                document.querySelectorAll('.filtro-dropdown.open').forEach(d => d.classList.remove('open'));
            }
        });

        document.querySelectorAll('.filtro-opcoes').forEach(container => {
            container.addEventListener('change', (e) => {
                if (e.target.type !== 'checkbox') return;
                const campo = container.closest('.filtro-dropdown').dataset.campo;
                const valor = e.target.value;
                if (e.target.checked) filtrosSelecionados[campo].add(valor);
                else filtrosSelecionados[campo].delete(valor);
                atualizarBadgeFiltro(campo);
                renderTable();
            });
        });

        document.querySelectorAll('.filtro-busca').forEach(input => {
            input.addEventListener('input', () => {
                const termo = input.value.toLowerCase();
                const campo = input.closest('.filtro-dropdown').dataset.campo;
                document.querySelectorAll(`#filtro-${campo}-opcoes .filtro-opcao`).forEach(opcao => {
                    const texto = opcao.textContent.toLowerCase();
                    opcao.style.display = texto.includes(termo) ? '' : 'none';
                });
            });
        });

        document.querySelectorAll('.filtro-panel-acoes button').forEach(btn => {
            btn.addEventListener('click', () => {
                const dropdown = btn.closest('.filtro-dropdown');
                const campo = dropdown.dataset.campo;
                const marcar = btn.dataset.acao === 'todos';
                dropdown.querySelectorAll('.filtro-opcoes .filtro-opcao').forEach(opcao => {
                    if (opcao.style.display === 'none') return;
                    const checkbox = opcao.querySelector('input[type=checkbox]');
                    if (!checkbox) return;
                    checkbox.checked = marcar;
                    if (marcar) filtrosSelecionados[campo].add(checkbox.value);
                    else filtrosSelecionados[campo].delete(checkbox.value);
                });
                atualizarBadgeFiltro(campo);
                renderTable();
            });
        });

        if (limparTodosFiltrosBtn) {
            limparTodosFiltrosBtn.addEventListener('click', () => {
                FILTROS_CONFIG.forEach(({ campo }) => {
                    filtrosSelecionados[campo] = new Set();
                    document.querySelectorAll(`#filtro-${campo}-opcoes input[type=checkbox]`).forEach(cb => { cb.checked = false; });
                    atualizarBadgeFiltro(campo);
                });
                renderTable();
            });
        }

        tabsBar.addEventListener('click', function(e) {
            const btn = e.target.closest('.tab-item');
            if (!btn) return;
            trocarAba(btn.dataset.status);
        });

        // ----- Seleção em massa -----

        function alternarSelecionarTodos(marcar) {
            if (marcar) {
                ultimosFiltrados.forEach(r => selecionados.add(r.id));
            } else {
                ultimosFiltrados.forEach(r => selecionados.delete(r.id));
            }
            renderTable();
        }

        if (selecionarTodosCheckbox) {
            selecionarTodosCheckbox.addEventListener('change', function() {
                alternarSelecionarTodos(selecionarTodosCheckbox.checked);
            });
        }

        if (selecionarTodosMobileCheckbox) {
            selecionarTodosMobileCheckbox.addEventListener('change', function() {
                alternarSelecionarTodos(selecionarTodosMobileCheckbox.checked);
            });
        }

        if (bulkLimpar) {
            bulkLimpar.addEventListener('click', function() {
                selecionados.clear();
                renderTable();
            });
        }

        if (bulkAprovar) {
            bulkAprovar.addEventListener('click', function() {
                if (selecionados.size === 0) return;
                setStatus(Array.from(selecionados), 'Aprovado', '');
            });
        }

        if (bulkAnalise) {
            bulkAnalise.addEventListener('click', function() {
                if (selecionados.size === 0) return;
                setStatus(Array.from(selecionados), 'Em análise', proximoDiaUtil());
            });
        }

        if (bulkNegar) {
            bulkNegar.addEventListener('click', function() {
                if (selecionados.size === 0) return;
                abrirModalData(Array.from(selecionados));
            });
        }

        // =====================================================================
        // ----- SALDO BANCÁRIO (Firestore + login Firebase + senha local) -----
        // =====================================================================
        const SENHA_SALT_HEX = '4b61288c477e06f0f761899cbab96a80';
        const SENHA_HASH_HEX = 'e30d48b55258dbf60f60ccdb2a6ed36f2d6a402704dbfe9c196e788ffaf30783';
        const SENHA_ITERACOES = 210000;
        const LS_AUTH = 'bimer_saldos_auth_v1';
        const AUTH_DIAS = 30;

        let saldoData = { contas: [], atualizadoEm: null };
        let saldoDesbloqueado = false;
        let ultimoAprovado = 0;
        let tentativasSenha = 0;
        let bloqueioAte = 0;

        const saldoCardEl = document.getElementById('cardSaldo');
        const saldoDisponivelValorEl = document.getElementById('saldoDisponivelValor');
        const saldoDisponivelSubEl = document.getElementById('saldoDisponivelSub');
        const saldoModal = document.getElementById('saldoModal');
        const saldoViewEl = document.getElementById('saldoView');
        const saldoEditEl = document.getElementById('saldoEdit');
        const saldoListaEl = document.getElementById('saldoLista');
        const saldoEditListaEl = document.getElementById('saldoEditLista');
        const senhaModal = document.getElementById('senhaModal');
        const senhaInput = document.getElementById('senhaInput');
        const senhaErro = document.getElementById('senhaErro');
        const senhaLembrar = document.getElementById('senhaLembrar');

        function formatarSaldo(valor) {
            return (valor < 0 ? '-' : '') + formatarValor(valor);
        }
        function formatarNumeroBr(valor) {
            return (valor < 0 ? '-' : '') + formatarValor(valor).replace('R$ ', '');
        }
        function lerValorBr(texto) {
            let s = String(texto == null ? '' : texto).replace(/R\$/gi, '').replace(/\s/g, '');
            if (!s) return NaN;
            const negativo = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
            s = s.replace(/[-()]/g, '');
            if (!/^[\d.,]+$/.test(s)) return NaN;
            if (s.includes(',')) {
                s = s.replace(/\./g, '').replace(',', '.');
            } else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) {
                s = s.replace(/\./g, '');
            }
            const n = parseFloat(s);
            if (isNaN(n)) return NaN;
            return negativo ? -n : n;
        }
        function diaISO(d) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        function novoIdConta() {
            return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        }

        async function carregarSaldosDoFirestore() {
            try {
                const dados = await window.BimerAuth.lerSaldos();
                if (dados) {
                    saldoData = {
                        contas: dados.contas
                            .filter(c => c && typeof c.nome === 'string')
                            .map(c => ({ id: String(c.id || novoIdConta()), nome: c.nome, saldo: Number(c.saldo) || 0 })),
                        atualizadoEm: dados.atualizadoEm || null,
                    };
                } else {
                    saldoData = { contas: [], atualizadoEm: null };
                }
            } catch (e) {
                console.warn('Não foi possível ler os saldos do Firestore:', e);
                saldoData = { contas: [], atualizadoEm: null };
            }
            atualizarSaldoCard();
        }

        async function persistirSaldos() {
            try {
                await window.BimerAuth.salvarSaldos(saldoData);
                return true;
            } catch (e) {
                console.error('Erro ao salvar saldos no Firestore:', e);
                alert('Não foi possível salvar os saldos. Verifique se você está logado e se as regras do Firestore permitem a escrita.');
                return false;
            }
        }

        function totalLancado() {
            return saldoData.contas.reduce((s, c) => s + (c.saldo || 0), 0);
        }

        function hexParaBytes(hex) {
            const out = new Uint8Array(hex.length / 2);
            for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
            return out;
        }
        function bytesParaHex(buf) {
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        async function derivarHash(senha) {
            if (!window.crypto || !window.crypto.subtle) {
                throw new Error('Este recurso exige HTTPS (ou localhost) para validar a senha.');
            }
            const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
            const bits = await crypto.subtle.deriveBits(
                { name: 'PBKDF2', salt: hexParaBytes(SENHA_SALT_HEX), iterations: SENHA_ITERACOES, hash: 'SHA-256' },
                chave, 256
            );
            return bytesParaHex(bits);
        }
        function lembrarDesbloqueio(lembrar) {
            try {
                if (lembrar) {
                    localStorage.setItem(LS_AUTH, JSON.stringify({ t: SENHA_HASH_HEX, exp: Date.now() + AUTH_DIAS * 86400000 }));
                } else {
                    localStorage.removeItem(LS_AUTH);
                }
            } catch (e) { /* sem armazenamento: vale só nesta sessão */ }
        }
        function restaurarDesbloqueio() {
            try {
                const obj = JSON.parse(localStorage.getItem(LS_AUTH) || 'null');
                if (obj && obj.t === SENHA_HASH_HEX && obj.exp > Date.now()) {
                    saldoDesbloqueado = true;
                } else if (obj) {
                    localStorage.removeItem(LS_AUTH);
                }
            } catch (e) { /* ignora */ }
        }

        function atualizarSaldoCard(totalAprovado) {
            if (typeof totalAprovado === 'number') ultimoAprovado = totalAprovado;
            if (!saldoDisponivelValorEl) return;
            const lancado = totalLancado();
            const disponivel = lancado - ultimoAprovado;
            saldoDisponivelValorEl.textContent = formatarSaldo(disponivel);
            saldoCardEl.classList.toggle('saldo-negativo', disponivel < 0);
            saldoDisponivelSubEl.textContent = saldoData.contas.length === 0
                ? 'Nenhum saldo lançado'
                : `Lançado ${formatarSaldo(lancado)} · Aprovado −${formatarValor(ultimoAprovado)}`;
            if (saldoModal.classList.contains('active') && saldoViewEl.style.display !== 'none') {
                renderSaldoView();
            }
        }

        function renderSaldoView() {
            const lancado = totalLancado();
            const disponivel = lancado - ultimoAprovado;
            document.getElementById('resumoLancado').textContent = formatarSaldo(lancado);
            document.getElementById('resumoAprovado').textContent = '−' + formatarValor(ultimoAprovado);
            const dispEl = document.getElementById('resumoDisponivel');
            dispEl.textContent = formatarSaldo(disponivel);
            dispEl.classList.toggle('negativo', disponivel < 0);

            saldoListaEl.innerHTML = saldoData.contas.length === 0
                ? '<div class="saldo-vazio"><i class="fas fa-circle-info"></i> Nenhuma conta cadastrada. Use "Atualizar saldos" para cadastrar.</div>'
                : saldoData.contas.map(c => `
                    <div class="saldo-conta">
                        <span class="saldo-conta-nome"><i class="fas fa-building-columns"></i> ${escHtml(c.nome)}</span>
                        <strong class="${c.saldo < 0 ? 'negativo' : ''}">${formatarSaldo(c.saldo)}</strong>
                    </div>`).join('');

            const info = document.getElementById('saldoAtualizadoEm');
            const aviso = document.getElementById('saldoAvisoDesatualizado');
            if (saldoData.atualizadoEm) {
                const d = new Date(saldoData.atualizadoEm);
                info.textContent = `Última atualização: ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                if (diaISO(d) !== diaISO(new Date())) {
                    aviso.style.display = 'block';
                    aviso.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Os saldos não foram atualizados hoje.';
                } else {
                    aviso.style.display = 'none';
                }
            } else {
                info.textContent = '';
                aviso.style.display = 'none';
            }
        }
        function abrirSaldoDetalhes() {
            saldoViewEl.style.display = '';
            saldoEditEl.style.display = 'none';
            renderSaldoView();
            saldoModal.classList.add('active');
        }
        function fecharSaldoModal() {
            saldoModal.classList.remove('active');
        }

        function linhaEdicaoHtml(conta, vazia) {
            return `<div class="saldo-edit-row" data-id="${escAttr(conta.id)}">
                <input type="text" class="conta-nome" placeholder="Nome da conta (ex.: Santander Gavea)" value="${vazia ? '' : escAttr(conta.nome)}" maxlength="60">
                <input type="text" class="conta-valor" inputmode="decimal" placeholder="0,00" value="${vazia ? '' : escAttr(formatarNumeroBr(conta.saldo))}">
                <button type="button" class="btn-remover-conta" title="Remover conta"><i class="fas fa-trash"></i></button>
            </div>`;
        }
        function adicionarLinhaConta() {
            saldoEditListaEl.insertAdjacentHTML('beforeend', linhaEdicaoHtml({ id: novoIdConta(), nome: '', saldo: 0 }, true));
            saldoEditListaEl.lastElementChild.querySelector('.conta-nome').focus();
        }
        function abrirEdicaoSaldos() {
            saldoViewEl.style.display = 'none';
            saldoEditEl.style.display = '';
            saldoEditListaEl.innerHTML = saldoData.contas.map(c => linhaEdicaoHtml(c, false)).join('');
            if (saldoData.contas.length === 0) adicionarLinhaConta();
            atualizarTotalEdicao();
            saldoModal.classList.add('active');
        }
        function atualizarTotalEdicao() {
            let total = 0;
            saldoEditListaEl.querySelectorAll('.conta-valor').forEach(inp => {
                const v = lerValorBr(inp.value);
                if (!isNaN(v)) total += v;
            });
            document.getElementById('saldoEditTotal').textContent = formatarSaldo(total);
        }
        async function salvarEdicaoSaldos() {
            const contas = [];
            const nomesUsados = new Set();
            let erro = '';
            saldoEditListaEl.querySelectorAll('.saldo-edit-row').forEach(linha => {
                const inpNome = linha.querySelector('.conta-nome');
                const inpValor = linha.querySelector('.conta-valor');
                inpNome.classList.remove('invalido');
                inpValor.classList.remove('invalido');
                const nome = inpNome.value.trim();
                const textoValor = inpValor.value.trim();
                if (!nome && !textoValor) return;
                if (!nome) { inpNome.classList.add('invalido'); erro = erro || 'Informe o nome de todas as contas.'; return; }
                const chave = nome.toLowerCase();
                if (nomesUsados.has(chave)) { inpNome.classList.add('invalido'); erro = erro || `A conta "${nome}" está repetida.`; return; }
                nomesUsados.add(chave);
                const valor = textoValor === '' ? 0 : lerValorBr(textoValor);
                if (isNaN(valor)) { inpValor.classList.add('invalido'); erro = erro || `Valor inválido na conta "${nome}".`; return; }
                contas.push({ id: linha.dataset.id, nome, saldo: Math.round(valor * 100) / 100 });
            });
            if (erro) { alert(erro); return; }
            saldoData = { contas, atualizadoEm: new Date().toISOString() };
            if (!(await persistirSaldos())) return;
            atualizarSaldoCard();
            abrirSaldoDetalhes();
        }

        function pedirSenha() {
            const user = window.BimerAuth?.usuarioAtual?.();
            if (!user) {
                abrirLoginFirebase(() => pedirSenha());
                return;
            }
            if (saldoDesbloqueado) { abrirEdicaoSaldos(); return; }
            senhaInput.value = '';
            senhaErro.textContent = '';
            senhaLembrar.checked = false;
            senhaModal.classList.add('active');
            setTimeout(() => senhaInput.focus(), 100);
        }
        function fecharSenhaModal() {
            senhaModal.classList.remove('active');
            senhaInput.value = '';
        }
        async function confirmarSenha() {
            const agora = Date.now();
            if (agora < bloqueioAte) {
                senhaErro.textContent = `Muitas tentativas. Aguarde ${Math.ceil((bloqueioAte - agora) / 1000)}s.`;
                return;
            }
            const digitada = senhaInput.value;
            if (!digitada) { senhaErro.textContent = 'Digite a senha.'; return; }
            const btn = document.getElementById('confirmarSenha');
            btn.disabled = true;
            try {
                const hash = await derivarHash(digitada);
                if (hash === SENHA_HASH_HEX) {
                    tentativasSenha = 0;
                    saldoDesbloqueado = true;
                    lembrarDesbloqueio(senhaLembrar.checked);
                    fecharSenhaModal();
                    abrirEdicaoSaldos();
                } else {
                    tentativasSenha++;
                    senhaInput.value = '';
                    if (tentativasSenha >= 5) {
                        bloqueioAte = Date.now() + 30000;
                        tentativasSenha = 0;
                        senhaErro.textContent = 'Senha incorreta. Aguarde 30s para tentar de novo.';
                    } else {
                        senhaErro.textContent = 'Senha incorreta.';
                    }
                }
            } catch (e) {
                senhaErro.textContent = e.message;
            } finally {
                btn.disabled = false;
            }
        }
        function bloquearSaldos() {
            saldoDesbloqueado = false;
            lembrarDesbloqueio(false);
            abrirSaldoDetalhes();
        }

        async function abrirLoginFirebase(aoLogar) {
            const email = window.prompt('E-mail (Firebase):');
            if (!email) return;
            const senha = window.prompt('Senha (Firebase):');
            if (!senha) return;
            try {
                await window.BimerAuth.login(email, senha);
                if (typeof aoLogar === 'function') aoLogar();
            } catch (e) {
                alert('Falha no login: ' + (e.message || e.code || 'erro desconhecido'));
            }
        }

        document.getElementById('abrirSaldoDetalhes').addEventListener('click', abrirSaldoDetalhes);
        document.getElementById('fecharSaldoView').addEventListener('click', fecharSaldoModal);
        document.getElementById('irParaEdicaoSaldo').addEventListener('click', pedirSenha);
        document.getElementById('cancelarEdicaoSaldo').addEventListener('click', abrirSaldoDetalhes);
        document.getElementById('salvarSaldos').addEventListener('click', salvarEdicaoSaldos);
        document.getElementById('addConta').addEventListener('click', adicionarLinhaConta);
        document.getElementById('bloquearSaldos').addEventListener('click', bloquearSaldos);
        document.getElementById('confirmarSenha').addEventListener('click', confirmarSenha);
        document.getElementById('cancelarSenha').addEventListener('click', fecharSenhaModal);
        senhaInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmarSenha(); });
        saldoModal.addEventListener('click', e => { if (e.target === saldoModal && saldoEditEl.style.display === 'none') fecharSaldoModal(); });
        senhaModal.addEventListener('click', e => { if (e.target === senhaModal) fecharSenhaModal(); });

        saldoEditListaEl.addEventListener('click', e => {
            const btn = e.target.closest('.btn-remover-conta');
            if (!btn) return;
            btn.closest('.saldo-edit-row').remove();
            atualizarTotalEdicao();
        });
        saldoEditListaEl.addEventListener('input', e => {
            if (e.target.classList.contains('conta-valor')) atualizarTotalEdicao();
        });
        saldoEditListaEl.addEventListener('focusout', e => {
            if (!e.target.classList.contains('conta-valor')) return;
            const v = lerValorBr(e.target.value);
            if (!isNaN(v)) e.target.value = formatarNumeroBr(v);
        });

        // ----- DETALHES DOS CARDS (Total Geral / Aprovado / Em Atraso) -----
        const detalhesModal = document.getElementById('detalhesModal');
        const detalhesModalBox = detalhesModal.querySelector('.detalhes-modal');
        const detalhesListaEl = document.getElementById('detalhesLista');
        const detalhesToggleEl = document.getElementById('detalhesToggle');
        let detalhesTipo = 'geral';
        let detalhesAgrupar = 'natureza';

        const DETALHES_CONFIG = {
            geral:    { titulo: 'Total Geral em Aberto', icone: 'fa-layer-group',          filtro: () => true },
            aprovado: { titulo: 'Valor Aprovado',        icone: 'fa-check-circle',         filtro: r => r.status === 'Aprovado' },
            atraso:   { titulo: 'Em Atraso',             icone: 'fa-triangle-exclamation', filtro: r => r.atrasoDias !== null && r.atrasoDias !== undefined && r.atrasoDias > 0 },
        };

        function renderDetalhes() {
            const cfg = DETALHES_CONFIG[detalhesTipo];
            const lista = registros.filter(cfg.filtro);
            const total = lista.reduce((s, r) => s + Math.abs(r.vlAberto || 0), 0);

            const grupos = new Map();
            lista.forEach(r => {
                const chave = String(r[detalhesAgrupar] || 'N/A').trim() || 'N/A';
                const g = grupos.get(chave) || { nome: chave, valor: 0, qtd: 0 };
                g.valor += Math.abs(r.vlAberto || 0);
                g.qtd += 1;
                grupos.set(chave, g);
            });
            const ordenados = Array.from(grupos.values()).sort((a, b) => b.valor - a.valor);

            detalhesModalBox.dataset.tipo = detalhesTipo;
            document.getElementById('detalhesTitulo').innerHTML = `<i class="fas ${cfg.icone}"></i> ${escHtml(cfg.titulo)}`;
            document.getElementById('detalhesResumoLabel').textContent = cfg.titulo;
            document.getElementById('detalhesResumoValor').textContent = formatarValor(total);
            document.getElementById('detalhesResumoQtd').textContent = lista.length;
            detalhesToggleEl.querySelectorAll('button').forEach(b =>
                b.classList.toggle('active', b.dataset.agrupar === detalhesAgrupar));

            detalhesListaEl.innerHTML = ordenados.length === 0
                ? '<div class="detalhes-vazio"><i class="fas fa-circle-info"></i> Nenhum título para exibir.</div>'
                : ordenados.map(g => {
                    const pct = total > 0 ? (g.valor / total) * 100 : 0;
                    return `<div class="detalhes-item">
                        <div class="detalhes-item-topo">
                            <span class="detalhes-item-nome">${escHtml(g.nome)}</span>
                            <span class="detalhes-item-valor">${formatarValor(g.valor)}</span>
                        </div>
                        <div class="detalhes-barra"><span style="width:${pct.toFixed(1)}%"></span></div>
                        <div class="detalhes-item-sub">
                            <span>${g.qtd} título${g.qtd === 1 ? '' : 's'}</span>
                            <span>${pct.toFixed(1).replace('.', ',')}%</span>
                        </div>
                    </div>`;
                }).join('');
        }

        function abrirDetalhes(tipo) {
            detalhesTipo = tipo;
            renderDetalhes();
            detalhesModal.classList.add('active');
        }
        function fecharDetalhes() { detalhesModal.classList.remove('active'); }

        document.querySelectorAll('.btn-card-detalhes').forEach(btn =>
            btn.addEventListener('click', () => abrirDetalhes(btn.dataset.detalhes)));
        detalhesToggleEl.addEventListener('click', e => {
            const b = e.target.closest('button[data-agrupar]');
            if (!b) return;
            detalhesAgrupar = b.dataset.agrupar;
            renderDetalhes();
        });
        document.getElementById('fecharDetalhes').addEventListener('click', fecharDetalhes);
        detalhesModal.addEventListener('click', e => { if (e.target === detalhesModal) fecharDetalhes(); });

        restaurarDesbloqueio();
        atualizarSaldoCard(0);
        carregarSaldosDoFirestore();

        window.BimerAuth?.aoMudarLogin?.(() => { /* hook opcional */ });

    })();