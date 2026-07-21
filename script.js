    (function(){
        // ----- ESTADO -----
        let registros = [];
        let colMap = {};
        let pendingNegateId = null;
        let flatpickrInstance = null;

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
            if (dataStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) return dataStr;
            const partes = dataStr.split('-');
            if (partes.length === 3) {
                return `${partes[2]}/${partes[1]}/${partes[0]}`;
            }
            return dataStr;
        }

        // Formatar uma data vinda da planilha (objeto Date do SheetJS) para dd/mm/aaaa,
        // usando os métodos UTC para não sofrer o deslocamento de fuso horário (-1 dia)
        function formatarDataExcel(valor) {
            if (!valor) return '';
            if (valor instanceof Date && !isNaN(valor)) {
                const dia = String(valor.getUTCDate()).padStart(2, '0');
                const mes = String(valor.getUTCMonth() + 1).padStart(2, '0');
                const ano = valor.getUTCFullYear();
                return `${dia}/${mes}/${ano}`;
            }
            return String(valor).trim();
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
        function loadWorkbook(data) {
            try {
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                
                // Converter para JSON ignorando linhas vazias
                const json = XLSX.utils.sheet_to_json(firstSheet, { 
                    defval: '',
                    blankrows: false 
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
                const linhasValidas = json.filter(row => {
                    const nome = getVal(row, 'Nome da pessoa');
                    const empresa = getVal(row, 'Empresa');
                    return nome || empresa;
                });

                console.log('Linhas válidas encontradas:', linhasValidas.length);

                if (linhasValidas.length === 0) {
                    alert('Nenhuma linha com dados válidos encontrada. Verifique se a planilha tem os cabeçalhos corretos.');
                    return;
                }

                registros = linhasValidas.map((row, idx) => {
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

                    // Dt. venc. programado - pega o valor BRUTO da célula (pode ser um objeto Date
                    // do SheetJS), pois passar por getVal() converteria a data em texto errado
                    const chaveDtVenc = colMap['Dt. venc. programado'];
                    const dtVencRaw = chaveDtVenc !== undefined ? row[chaveDtVenc] : '';
                    const dtVencimento = formatarDataExcel(dtVencRaw);
                    
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
                    };
                });

                console.log('Registros processados:', registros.length);

                fileStatus.textContent = `✅ ${fileInput.files[0]?.name || 'planilha'}`;
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

            if (registros.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="11">
                            <div class="empty-state">
                                <i class="fas fa-file-upload"></i>
                                <p>Carregue uma planilha para começar</p>
                                <p style="font-size:13px; margin-top:8px; color:#8aa3c0;">Clique em "Importar planilha" para selecionar o arquivo</p>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }

            if (filtered.length === 0) {
                const nomeAba = abaAtual || 'Todos';
                tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:24px; color:#6e8aaa;">Nenhum registro em "${escHtml(nomeAba)}" com esses filtros</td></tr>`;
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
                    <td class="badge-empresa">${escHtml(r.empresa)}</td>
                    <td>${escHtml(r.nomePessoa)}</td>
                    <td>${r.nrTitulo ? `<span class="nr-titulo"><i class="fas fa-hashtag"></i> ${escHtml(r.nrTitulo)}</span>` : '—'}</td>
                    <td>${escHtml(r.dtVencimento)}</td>
                    <td>${escHtml(r.natureza)}</td>
                    <td>${escHtml(r.centroCusto)}</td>
                    <td class="valor">${valorFormatado}</td>
                    <td class="observacao-cell">
                        ${obsPreview ? `<button class="btn-pequeno" data-idx="${r.id}"><i class="fas fa-eye"></i> ver</button>` : '—'}
                    </td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td>
                        ${(r.status === 'Negado' || r.status === 'Em análise') && r.novoVencimento ? `<span style="font-size:11px; background:#eef3fa; padding:2px 10px; border-radius:30px;">${dataExibicao}</span>` : '—'}
                    </td>
                    <td>
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
            document.querySelectorAll('.btn-aprovar').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    setStatus(idx, 'Aprovado', '');
                });
            });

            document.querySelectorAll('.btn-negar').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    abrirModalData(idx);
                });
            });

            document.querySelectorAll('.btn-analise').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    setStatus(idx, 'Em análise', proximoDiaUtil());
                });
            });

            // Observação modal
            document.querySelectorAll('.btn-pequeno').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(btn.dataset.idx);
                    const reg = registros.find(r => r.id === idx);
                    if (reg) {
                        obsTexto.textContent = reg.observacao || '(sem observação)';
                        obsModal.classList.add('active');
                    }
                });
            });
        }

        // Abrir modal de data
        function abrirModalData(idx) {
            pendingNegateId = idx;
            novaDataInput.value = '';
            avisoFimSemana.classList.remove('active');
            dataModal.classList.add('active');
            
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
            pendingNegateId = null;
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

            if (pendingNegateId !== null) {
                setStatus(pendingNegateId, 'Negado', dataStr);
                fecharModalData();
            }
        }

        // Set status
        function setStatus(id, novoStatus, novoVenc) {
            const reg = registros.find(r => r.id === id);
            if (!reg) return;
            reg.status = novoStatus;
            if (novoStatus === 'Negado' || novoStatus === 'Em análise') {
                reg.novoVencimento = novoVenc || '';
            } else {
                reg.novoVencimento = '';
            }
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
                    });

                    row.eachCell((cell) => {
                        cell.border = { top: bordaFina, left: bordaFina, right: bordaFina, bottom: bordaFina };
                        cell.alignment = { vertical: 'middle' };
                    });

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
                sheet.autoFilter = { from: 'A1', to: 'J1' };

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
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const dataArquivo = new Date().toISOString().slice(0, 10);
                a.href = url;
                a.download = `relatorio_aprovacao_bimer_${dataArquivo}.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Erro ao gerar Excel:', error);
                alert('Erro ao gerar o Excel: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = textoOriginal;
            }
        });

        // ----- PDF -----
        document.getElementById('gerar-pdf').addEventListener('click', function() {
            if (registros.length === 0) {
                alert('Carregue uma planilha antes de gerar o relatório.');
                return;
            }

            // Bloqueia a geração enquanto houver pagamentos ainda como "Pendente"
            const pendentes = registros.filter(r => r.status === 'Pendente');
            if (pendentes.length > 0) {
                alert(`Ainda há ${pendentes.length} pagamento(s) como "Pendente".\n\nAprove, negue ou coloque em análise todos os títulos antes de gerar o relatório em PDF.`);
                trocarAba('Pendente');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('landscape', 'pt', 'a4');
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeightDoc = doc.internal.pageSize.getHeight();
            const margin = 32;

            const aprovados = registros.filter(r => r.status === 'Aprovado');
            const negados = registros.filter(r => r.status === 'Negado');
            const emAnalise = registros.filter(r => r.status === 'Em análise');

            if (aprovados.length === 0 && negados.length === 0 && emAnalise.length === 0) {
                alert('Não há itens aprovados, negados ou em análise para gerar o PDF.');
                return;
            }

            // ----- Cabeçalho -----
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(16);
            doc.setTextColor(11, 43, 74);
            doc.text('Relatório de Aprovação de Pagamentos', margin, 38);

            doc.setFontSize(11);
            doc.setTextColor(62, 94, 122);
            doc.text('BIMER', margin, 55);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(120, 140, 165);
            doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 38, { align: 'right' });

            doc.setDrawColor(220, 230, 245);
            doc.setLineWidth(1);
            doc.line(margin, 66, pageWidth - margin, 66);

            // ----- Resumo -----
            const somaValor = (arr) => arr.reduce((s, r) => s + Math.abs(r.vlAberto ?? r.vlTitulo ?? 0), 0);
            const totalAprovadoValor = somaValor(aprovados);
            const totalNegadoValor = somaValor(negados);
            const totalAnaliseValor = somaValor(emAnalise);

            let y = 86;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(19, 115, 61);
            doc.text(`Aprovados: ${aprovados.length}  •  ${formatarValor(totalAprovadoValor)}`, margin, y);
            doc.setTextColor(148, 46, 46);
            doc.text(`Negados: ${negados.length}  •  ${formatarValor(totalNegadoValor)}`, margin + 220, y);
            doc.setTextColor(150, 100, 20);
            doc.text(`Em análise: ${emAnalise.length}  •  ${formatarValor(totalAnaliseValor)}`, margin + 420, y);
            y += 22;

            // ----- Colunas -----
            const headers = ['Empresa', 'Pessoa', 'Nr. Título', 'Dt. Vencimento', 'Natureza', 'Centro de Custo', 'Valor', 'Novo Venc.'];
            const columnStyles = {
                0: { cellWidth: 110 },
                1: { cellWidth: 110 },
                2: { cellWidth: 78 },
                3: { cellWidth: 65, halign: 'center' },
                4: { cellWidth: 100 },
                5: { cellWidth: 100 },
                6: { cellWidth: 70, halign: 'right' },
                7: { cellWidth: 58, halign: 'center' },
            };
            const baseStyles = {
                font: 'helvetica',
                fontSize: 8,
                cellPadding: 5,
                overflow: 'linebreak',
                valign: 'middle',
                textColor: [26, 52, 77],
                lineColor: [226, 233, 242],
                lineWidth: 0.5,
            };

            function buildBody(data) {
                return data.map(r => [
                    r.empresa,
                    r.nomePessoa,
                    r.nrTitulo || '—',
                    r.dtVencimento || '—',
                    r.natureza,
                    r.centroCusto,
                    formatarValor(r.vlAberto ?? r.vlTitulo ?? 0),
                    (r.status === 'Negado' || r.status === 'Em análise') ? (formatarDataParaExibicao(r.novoVencimento) || '—') : '—',
                ]);
            }

            function desenharSecao(titulo, data, corTitulo, corCabecalho) {
                if (data.length === 0) return;
                if (y > pageHeightDoc - 120) {
                    doc.addPage();
                    y = 40;
                }
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(...corTitulo);
                doc.text(titulo, margin, y);

                doc.autoTable({
                    head: [headers],
                    body: buildBody(data),
                    startY: y + 8,
                    margin: { left: margin, right: margin, bottom: 36 },
                    styles: baseStyles,
                    headStyles: { fillColor: corCabecalho, textColor: corTitulo, fontStyle: 'bold', fontSize: 8.5 },
                    alternateRowStyles: { fillColor: [249, 251, 253] },
                    columnStyles,
                    theme: 'grid',
                    // Evita que uma linha seja cortada ao meio entre duas páginas: se a linha
                    // inteira não couber no espaço restante, ela é movida por completo para a
                    // próxima página em vez de dividir o texto entre as duas folhas.
                    rowPageBreak: 'avoid',
                    didDrawPage: function() {
                        doc.setFontSize(8);
                        doc.setTextColor(150, 160, 175);
                        doc.text('Relatório de Aprovação de Pagamentos – BIMER', margin, pageHeightDoc - 15);
                    }
                });

                y = doc.lastAutoTable.finalY + 26;
            }

            desenharSecao('Itens Aprovados', aprovados, [10, 75, 42], [199, 240, 217]);
            desenharSecao('Itens Negados', negados, [127, 42, 42], [248, 212, 212]);
            desenharSecao('Itens Em Análise', emAnalise, [127, 94, 26], [255, 237, 201]);

            // ----- Numeração de páginas -----
            const totalPaginas = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPaginas; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150, 160, 175);
                doc.text(`Página ${i} de ${totalPaginas}`, pageWidth - margin, pageHeightDoc - 15, { align: 'right' });
            }

            const dataArquivo = new Date().toISOString().slice(0, 10);
            doc.save(`relatorio_aprovacao_bimer_${dataArquivo}.pdf`);
        });

        // ----- Eventos -----
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) {
                const data = new Uint8Array(ev.target.result);
                loadWorkbook(data);
            };
            reader.readAsArrayBuffer(file);
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

        // Inicialização vazia
        // Nenhum dado de exemplo

    })();
