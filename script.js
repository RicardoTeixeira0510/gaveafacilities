    (function(){
        // ----- ESTADO -----
        let registros = [];
        let colMap = {};
        let pendingNegateIds = []; // ids envolvidos na negação em andamento (1 = individual, várias = em massa)
        let flatpickrInstance = null;
        let selecionados = new Set(); // ids dos lançamentos marcados para ação em massa
        let ultimosFiltrados = []; // últimos registros exibidos na tabela (respeitando aba/filtros)

        // referências
        const tbody = document.getElementById('table-body');
        const fileInput = document.getElementById('file-input');
        const fileStatus = document.getElementById('file-status');
        const qtdRegistros = document.getElementById('qtdRegistros');
        const totalGeralAbertoEl = document.getElementById('totalGeralAberto');
        const totalAprovadoEl = document.getElementById('totalAprovado');
        const filterEmpresa = document.getElementById('filter-empresa');
        const filterNome = document.getElementById('filter-nome');
        const tabsBar = document.getElementById('tabsBar');
        let abaAtual = 'Pendente'; // guia ativa: Pendente, Em análise, Aprovado, Negado ou '' (Todos)

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
            // colMap guarda o nome real (já limpo) da coluna correspondente ao rótulo pedido
            const chave = colMap[label];
            if (chave === undefined) return '';
            const val = row[chave] !== undefined ? row[chave] : '';
            return String(val).trim();
        }

        // Formatar valor monetário (sem negativo)
        function formatarValor(valor) {
            const positivo = Math.abs(valor);
            return 'R$ ' + positivo.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        }

        // Atualizar os cards de totais no topo (sempre sobre TODOS os registros carregados,
        // independente dos filtros aplicados na tabela)
        function atualizarTotais() {
            const totalGeral = registros.reduce((soma, r) => soma + Math.abs(r.vlAberto || 0), 0);
            const totalAprovado = registros
                .filter(r => r.status === 'Aprovado')
                .reduce((soma, r) => soma + Math.abs(r.vlAberto || 0), 0);

            totalGeralAbertoEl.textContent = formatarValor(totalGeral);
            totalAprovadoEl.textContent = formatarValor(totalAprovado);
        }

        // Atualizar contador de cada guia (Pendente, Em análise, Aprovado, Negado, Todos)
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

        // Trocar de guia
        function trocarAba(novoStatus) {
            abaAtual = novoStatus;
            document.querySelectorAll('.tab-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.status === novoStatus);
            });
            renderTable();
        }

        // Verificar se é fim de semana
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

        // Formatar data para exibição
        function formatarDataParaExibicao(dataStr) {
            if (!dataStr) return '—';
            dataStr = String(dataStr).trim();
            // Remove eventual componente de hora junto (ex: "30/07/2026 00:00:00")
            dataStr = dataStr.split(' ')[0];
            if (dataStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) return dataStr;
            const partes = dataStr.split('-');
            if (partes.length === 3 && partes[0].length === 4) {
                return `${partes[2]}/${partes[1]}/${partes[0]}`;
            }
            return dataStr;
        }

        // Calcula o próximo dia útil (pula sábados e domingos) a partir de hoje,
        // retornando no formato dd/mm/aaaa usado no restante do sistema
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

        // Máscara de data automática
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

        // Carregar planilha - VERSÃO CORRIGIDA
        function loadWorkbook(data, nomeArquivo) {
            try {
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                
                // Converter para JSON ignorando linhas vazias
                const json = XLSX.utils.sheet_to_json(firstSheet, { 
                    defval: '',
                    blankrows: false 
                });

                // Versão "textual" da mesma planilha: aqui os valores vêm exatamente como
                // o Excel EXIBE na célula (respeitando o formato de data configurado na
                // planilha de origem), sem passar por objeto Date/conversão de fuso horário.
                // Usada só para extrair a Dt. Vencimento corretamente, evitando o problema
                // de "-1 dia" que pode ocorrer ao converter datas via objetos Date/UTC.
                const jsonTextual = XLSX.utils.sheet_to_json(firstSheet, {
                    defval: '',
                    blankrows: false,
                    raw: false
                });
                
                console.log('Total de linhas lidas:', json.length);
                
                if (!json || json.length === 0) {
                    alert('A planilha está vazia ou não possui cabeçalho.');
                    return;
                }

                // Mapear cabeçalhos (removendo caracteres especiais)
                const headers = Object.keys(json[0]);
                colMap = {};
                headers.forEach((h) => { 
                    // Remove dois pontos, espaços extras e normaliza
                    const cleanHeader = h.replace(/[:：]/g, '').trim();
                    colMap[cleanHeader] = h; // guarda a chave ORIGINAL usada no objeto retornado pelo SheetJS
                });

                console.log('Colunas encontradas:', Object.keys(colMap));

                // Verificar campos obrigatórios
                const required = ['Nome da pessoa', 'Empresa', 'Natureza de lançamento', 'Centro(s) de custo', 'Vl. título (atualizado)', 'Vl. em aberto', 'Dt. venc. programado'];
                const missing = required.filter(r => !(r in colMap));
                if (missing.length) {
                    alert(`Colunas obrigatórias não encontradas: ${missing.join(', ')}\n\nColunas disponíveis: ${Object.keys(colMap).join(', ')}`);
                    return;
                }

                // Filtrar linhas que têm pelo menos Nome da pessoa ou Empresa preenchidos
                // (mantendo o "par" json/jsonTextual de cada linha, pois json e jsonTextual
                // têm a mesma ordem/quantidade de linhas)
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
                    try {
                        vlTitulo = parseFloat(vlTituloStr) || 0;
                    } catch(e) {
                        vlTitulo = 0;
                    }

                    const vlAbertoStr = get('Vl. em aberto');
                    let vlAberto = 0;
                    try {
                        vlAberto = parseFloat(vlAbertoStr) || 0;
                    } catch(e) {
                        vlAberto = 0;
                    }

                    // Dt. venc. programado - pega o valor da versão TEXTUAL da planilha
                    // (jsonTextual/textRow), ou seja, exatamente como a data aparece
                    // formatada na planilha de origem, sem risco de deslocamento por fuso
                    const chaveDtVenc = colMap['Dt. venc. programado'];
                    const dtVencTexto = chaveDtVenc !== undefined ? String(textRow[chaveDtVenc] ?? '').trim() : '';
                    const dtVencimento = formatarDataParaExibicao(dtVencTexto) || dtVencTexto;
                    
                    // Monta o campo único "Dados de Pagamento" a partir de Chave PIX, Nr. agência
                    // e C/C fornecedor (cada um em sua própria linha, só entra se tiver valor)
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
                fileStatus.textContent = `✅ ${nomeArquivo || 'planilha'}`;
                qtdRegistros.textContent = `${registros.length} registros`;
                renderTable();
                
            } catch (error) {
                console.error('Erro ao ler planilha:', error);
                alert('Erro ao ler a planilha: ' + error.message);
            }
        }

        // Renderizar tabela
        function renderTable() {
            atualizarTotais();
            atualizarContadoresAbas();

            const filtroEmp = filterEmpresa.value.toLowerCase().trim();
            const filtroNome = filterNome.value.toLowerCase().trim();

            let filtered = registros.filter(r => {
                if (filtroEmp && !r.empresa.toLowerCase().includes(filtroEmp)) return false;
                if (filtroNome && !r.nomePessoa.toLowerCase().includes(filtroNome)) return false;
                if (abaAtual && r.status !== abaAtual) return false;
                return true;
            });
            ultimosFiltrados = filtered;

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
                const valorFormatado = formatarValor(r.vlTitulo);
                const obsPreview = r.observacao.length > 30 ? r.observacao.slice(0, 30)+'…' : r.observacao;
                const dataExibicao = formatarDataParaExibicao(r.novoVencimento);

                html += `<tr>
                    <td class="td-checkbox" data-label="Selecionar"><input type="checkbox" class="row-checkbox" data-idx="${r.id}" ${selecionados.has(r.id) ? 'checked' : ''}></td>
                    <td class="badge-empresa" data-label="Empresa">${escHtml(r.empresa)}</td>
                    <td data-label="Pessoa">${escHtml(r.nomePessoa)}</td>
                    <td data-label="Nr. Título">${r.nrTitulo ? `<span class="nr-titulo"><i class="fas fa-hashtag"></i> ${escHtml(r.nrTitulo)}</span>` : '—'}</td>
                    <td data-label="Vencimento">${escHtml(r.dtVencimento)}</td>
                    <td data-label="Natureza">${escHtml(r.natureza)}</td>
                    <td data-label="Centro de custo">${escHtml(r.centroCusto)}</td>
                    <td class="valor" data-label="Vl. título">${valorFormatado}</td>
                    <td class="observacao-cell" data-label="Observação">
                        ${obsPreview ? `<button class="btn-pequeno" data-idx="${r.id}"><i class="fas fa-eye"></i> ver</button>` : '—'}
                    </td>
                    <td data-label="Status"><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td data-label="Novo venc.">
                        ${(r.status === 'Negado' || r.status === 'Em análise') && r.novoVencimento ? `<span style="font-size:11px; background:#eef3fa; padding:2px 10px; border-radius:30px;">${dataExibicao}</span>` : '—'}
                    </td>
                    <td data-label="Ações">
                        <div class="btn-group">
                            <button class="btn-aprovar" data-idx="${r.id}"><i class="fas fa-check"></i> Aprovar</button>
                            <button class="btn-negar" data-idx="${r.id}"><i class="fas fa-times"></i> Negar</button>
                            <button class="btn-analise" data-idx="${r.id}"><i class="fas fa-clock"></i> Análise</button>
                        </div>
                    </td>
                </tr>`;
            });
            tbody.innerHTML = html;

            // Eventos dos botões
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

            // Observação modal
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

            // Checkbox de cada linha (seleção para ações em massa)
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

        // Atualiza a barra de ações em massa (contador, visibilidade) e o estado dos
        // checkboxes "selecionar todos" (desktop e mobile) com base nos registros
        // atualmente visíveis na tabela
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

        // Atualiza checked/indeterminate de um checkbox só se ele realmente existir no
        // HTML (protege contra páginas com cache desatualizado/mesclando versões antigas)
        function setCheckboxState(checkbox, checked, indeterminate) {
            if (!checkbox) return;
            checkbox.checked = checked;
            checkbox.indeterminate = indeterminate;
        }

        // Abrir modal de data - aceita um único id ou uma lista de ids (ação em massa)
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

        // Verificar se a data é fim de semana
        function verificarFimSemana(dataStr) {
            if (isFimDeSemana(dataStr)) {
                avisoFimSemana.classList.add('active');
                const diaSemana = obterNomeDiaSemana(dataStr);
                avisoFimSemana.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ⚠️ Atenção: Esta data cai em um <strong>${diaSemana}</strong>. Considere alterar para o próximo dia útil.`;
            } else {
                avisoFimSemana.classList.remove('active');
            }
        }

        // Obter nome do dia da semana em português
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

        // Fechar modal de data
        function fecharModalData() {
            dataModal.classList.remove('active');
            pendingNegateIds = [];
            avisoFimSemana.classList.remove('active');
            if (flatpickrInstance) {
                flatpickrInstance.setDate(null);
                flatpickrInstance.input.value = '';
            }
        }

        // Confirmar data
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

            if (pendingNegateIds && pendingNegateIds.length) {
                setStatus(pendingNegateIds, 'Negado', dataStr);
                fecharModalData();
            }
        }

        // Aplica o novo status/nova data a um único registro (sem re-renderizar)
        function aplicarStatusRegistro(reg, novoStatus, novoVenc) {
            reg.status = novoStatus;
            if (novoStatus === 'Negado' || novoStatus === 'Em análise') {
                reg.novoVencimento = novoVenc || '';
            } else {
                reg.novoVencimento = '';
            }
        }

        // Set status - aceita um único id (number) ou uma lista de ids (array),
        // usado tanto pelos botões de ação de cada linha quanto pelas ações em massa
        function setStatus(idOuIds, novoStatus, novoVenc) {
            const ids = Array.isArray(idOuIds) ? idOuIds : [idOuIds];
            ids.forEach(id => {
                const reg = registros.find(r => r.id === id);
                if (reg) aplicarStatusRegistro(reg, novoStatus, novoVenc);
            });
            // Remove da seleção os itens que acabaram de ser processados
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

            // Bloqueia a geração enquanto houver pagamentos ainda como "Pendente"
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

                // Cores por status (fundo + texto), reaproveitando a paleta usada na tela
                const coresStatus = {
                    'Aprovado':   { fundo: 'FFDCF3E6', texto: 'FF0A4B2A' },
                    'Negado':     { fundo: 'FFF8D4D4', texto: 'FF7F2A2A' },
                    'Em análise': { fundo: 'FFFFEDC9', texto: 'FF7F5E1A' },
                    'Pendente':   { fundo: 'FFE2E9F2', texto: 'FF1A344D' },
                };
                const corAzulHeader = 'FF1D4B77';
                // Borda fina aplicada aos 4 lados de cada célula (equivalente a "Todas as Bordas" do Excel)
                const bordaFina = { style: 'thin', color: { argb: 'FFB7C4D6' } };

                // ---------- Aba 1: Relatório completo ----------
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

                // Estilo do cabeçalho
                const headerRow = sheet.getRow(1);
                headerRow.height = 24;
                headerRow.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: corAzulHeader } };
                    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    cell.border = { top: bordaFina, left: bordaFina, right: bordaFina, bottom: bordaFina };
                });

                // Linhas de dados
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
                        // Sem wrapText: a linha não cresce em altura. O texto completo fica
                        // salvo na célula e aparece por inteiro ao clicar nela para editar
                        // (barra de fórmulas do Excel), mesmo que visualmente fique cortado.
                        cell.alignment = { vertical: 'middle', wrapText: false };
                    });

                    // "Dados de Pagamento" pode ter várias linhas (PIX / AG / C/C), então essa
                    // célula usa wrapText para exibir tudo já visível, sem precisar clicar
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

                    // Sinalização por cor de acordo com o status (célula de status em destaque
                    // e leve tingimento da linha toda para facilitar a leitura visual)
                    const cor = coresStatus[r.status] || coresStatus['Pendente'];
                    const statusCell = row.getCell('status');
                    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor.fundo } };
                    statusCell.font = { color: { argb: cor.texto }, bold: true };
                    statusCell.alignment = { vertical: 'middle', horizontal: 'center' };
                });

                // Filtro automático em todo o cabeçalho (permite filtrar/ordenar por qualquer coluna)
                sheet.autoFilter = { from: 'A1', to: 'N1' };

                // ---------- Aba 2: Resumo ----------
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

                // Baixa o arquivo direto, sem passar por nenhum modal de escolha
                baixarExcelGerado(blob, nomeArquivo);
            } catch (error) {
                console.error('Erro ao gerar Excel:', error);
                alert('Erro ao gerar o Excel: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        });

        // Baixa o arquivo Excel gerado — funciona igual no PC e no celular
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

        // Lê um arquivo (vindo do clique no botão OU de arrastar-e-soltar) e carrega a planilha
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

        // Arrastar e soltar planilha diretamente na área de upload
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
                // Só remove o destaque se realmente saiu da área (evita "piscar" ao passar
                // por cima dos elementos filhos, como o botão e os textos)
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

        filterEmpresa.addEventListener('input', renderTable);
        filterNome.addEventListener('input', renderTable);

        tabsBar.addEventListener('click', function(e) {
            const btn = e.target.closest('.tab-item');
            if (!btn) return;
            trocarAba(btn.dataset.status);
        });

        // ----- Seleção em massa -----

        // Checkbox "selecionar todos" (desktop, no cabeçalho da tabela, e mobile, na
        // barra acima da tabela): marca/desmarca todos os itens atualmente visíveis
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

        // Inicialização vazia
        // Nenhum dado de exemplo

    })();
