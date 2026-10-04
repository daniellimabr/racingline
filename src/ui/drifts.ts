// Drift table and analysis (v24 renderDrifts() and analyze(), lines 163-190). The sim stores end
// reasons as codes; the Portuguese wording lives here. Markup holds only numbers and fixed text.
import type { DriftEnd, DriftRecord } from '../sim/index.ts';
import { fmt, pct } from '../render/scene.ts';

export const END_TEXT: Record<DriftEnd, string> = {
  spin: 'Rodou',
  off: 'Saiu do pátio',
  slow: 'Perdeu velocidade',
  gripLow: 'Traseira agarrou (acelerador abaixo do limite)',
  gripHigh: 'Traseira agarrou (com acelerador acima do limite)',
};

const TH = 'style="text-align:left;padding:4px 8px 4px 0;font-weight:500;color:var(--text-primary);border-bottom:0.5px solid var(--border)"';
const TD = 'style="padding:4px 8px 4px 0;border-bottom:0.5px solid var(--border)"';
const HEAD = ['#', 'Duração', 'Âng. máx', 'Âng. médio', 'km/h', 'Marcha', 'RPM médio', 'No corte', 'Acel. médio', 'Acima do limite', 'Oscil. acel.', 'Contraesterço', 'Fim'];
const rpm100 = (r: number) => Math.round(r / 100) * 100;

export function driftTableHtml(drifts: readonly DriftRecord[]): string {
  if (!drifts.length)
    return '<tr><td style="padding:4px 0;color:var(--text-muted)">Nenhum drift registrado ainda. Um drift conta quando a derrapagem passa de 14° por mais de 0,3 s.</td></tr>';
  const best = Math.max(...drifts.map((d) => d.dur));
  const head = '<tr>' + HEAD.map((h) => '<th scope="col" ' + TH + '>' + h + '</th>').join('') + '</tr>';
  const rows = drifts.map((d, i) => {
    const top = d.dur === best;
    const cells = [
      String(drifts.length - i),
      '<span style="color:' + (top ? '#3fae5a' : 'inherit') + ';font-weight:' + (top ? 500 : 400) + '">' + fmt(d.dur, 1) + ' s</span>',
      Math.round(d.maxB) + '°', Math.round(d.avgB) + '°', String(Math.round(d.kmh)), d.gear + 'ª', String(rpm100(d.rpm)),
      pct(d.cut) + '%', pct(d.thr) + '% <span style="color:var(--text-muted)">(lim. ' + pct(d.lim) + '%)</span>',
      pct(d.above) + '%', pct(d.sd * 2) + '%', pct(d.cs) + '%', END_TEXT[d.end],
    ];
    return '<tr>' + cells.map((c) => '<td ' + TD + '>' + c + '</td>').join('') + '</tr>';
  });
  return head + rows.join('');
}

export function analysisHtml(drifts: readonly DriftRecord[]): string {
  const N = drifts.length;
  if (!N) return 'Faça alguns drifts para gerar a análise.';
  const avg = (f: (d: DriftRecord) => number) => drifts.reduce((a, d) => a + f(d), 0) / N;
  const share = (e: DriftEnd) => drifts.filter((d) => d.end === e).length / N;
  const spin = share('spin'), gripLow = share('gripLow'), gripHigh = share('gripHigh'), slow = share('slow');
  const above = avg((d) => d.above), cs = avg((d) => d.cs), sd = avg((d) => d.sd), kmh = avg((d) => d.kmh), dur = avg((d) => d.dur);
  const best = Math.max(...drifts.map((d) => d.dur)), aB = avg((d) => d.avgB), thrGap = avg((d) => d.thr - d.lim);
  const rpm = avg((d) => d.rpm), cut = avg((d) => d.cut);
  const tips: string[] = [], phys: string[] = [];
  if (N < 3) tips.push('Poucos dados ainda (' + N + ' drift' + (N > 1 ? 's' : '') + '). A análise fica mais confiável a partir de 3 a 5 drifts.');
  if (spin >= 0.4) tips.push('<b>Você está passando do ponto.</b> ' + pct(spin) + '% terminaram em rodada, com o acelerador em média ' + Math.round(thrGap * 100) + ' pontos acima do traço branco. Mire de 5 a 15 pontos acima do traço, não o fundo.');
  if (gripLow >= 0.4) tips.push('<b>Seu drift morre por falta de acelerador.</b> Em ' + pct(gripLow) + '% dos casos a barra verde caiu abaixo do traço branco. Ao ver o halo apagando, dê um toque no W.');
  if (cut > 0.3) tips.push('<b>Você passa ' + pct(cut) + '% do drift no corte de giro.</b> O corte salva a rodada, mas deixa o drift instável. Suba uma marcha (.) ou alivie o W um pouco antes do vermelho do conta-giros.');
  if (rpm < 4000 && N >= 2) tips.push('<b>Rotação baixa no drift</b> (média de ' + rpm100(rpm) + ' rpm). Abaixo de ~4000 rpm o motor não tem torque para manter a traseira solta; reduza uma marcha (,).');
  if (cs < 0.6) tips.push('<b>Pouco contraesterço:</b> ' + pct(cs) + '% do tempo. Acima de 45° de ângulo, as rodas precisam de quase todo o esterço para o lado da derrapagem.');
  if (aB > 45 && spin >= 0.3) tips.push('<b>Ângulo grande demais</b> (média de ' + Math.round(aB) + '°). Busque 25 a 40°: é mais fácil de segurar e o carro perde menos velocidade.');
  if (sd > 0.22) tips.push('<b>Acelerador oscilando muito</b> (oscilação de ' + pct(sd * 2) + '%). Segure o W e solte em toques curtos para ficar perto do traço.');
  if (kmh < 30) tips.push('<b>Velocidade baixa</b> (média de ' + Math.round(kmh) + ' km/h). Entre entre 40 e 50 km/h, em 2ª marcha.');
  if (slow >= 0.4) tips.push('<b>O carro perde velocidade e o drift acaba.</b> Segure um ângulo menor com um pouco mais de acelerador.');
  if (!tips.length) tips.push('Boa consistência. Seu melhor drift durou ' + fmt(best, 1) + ' s. Para alongar, encadeie os dois círculos do oito invertendo o contraesterço no meio.');
  if (gripHigh >= 0.35 && above > 0.6) phys.push('Em ' + pct(gripHigh) + '% dos drifts a traseira agarrou mesmo com o acelerador acima do limite. Isso sugere que a <b>física recupera aderência rápido demais</b>; o ajuste candidato é suavizar a queda da curva de pneu depois do pico.');
  if (sd > 0.22 && gripLow + spin >= 0.6) phys.push('A oscilação alta do acelerador com fins abruptos aponta uma <b>limitação de controle</b>: no teclado é difícil segurar o pedal entre 60 e 75%. O ajuste candidato é uma rampa mais fina perto do limite de tração.');
  if (!phys.length && N >= 3) phys.push('Nada nos dados aponta um problema claro da física: os fins de drift se explicam pela pilotagem.');
  const list = (xs: string[]) => xs.map((t) => '<div>• ' + t + '</div>').join('');
  return '<div style="margin-bottom:4px">Média: ' + fmt(dur, 1) + ' s por drift · melhor: ' + fmt(best, 1) + ' s · acelerador acima do limite em ' + pct(above) + '% do tempo · ' + rpm100(rpm) + ' rpm médio · ' + pct(cut) + '% no corte</div>' +
    '<div style="font-weight:500;color:var(--text-primary);margin-top:6px">Pilotagem</div>' + list(tips) +
    (phys.length ? '<div style="font-weight:500;color:var(--text-primary);margin-top:6px">Física</div>' + list(phys) : '');
}
