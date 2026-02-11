import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AppSettings, InterviewResult, RubricItem } from '../types';

export const generatePDF = (
  settings: AppSettings,
  rubric: RubricItem[],
  results: Record<string, InterviewResult>
) => {
  const doc = new jsPDF();

  doc.setFontSize(22);
  doc.setTextColor(30, 64, 175); // Blue-800
  doc.text('Interview Summary Report', 14, 20);

  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Candidate: ${settings.candidateName}`, 14, 30);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 36);
  doc.text(`Model: ${settings.modelName}`, 14, 42);

  const ratedItems = rubric.filter(item => results[item.id]?.rating > 0);
  const totalScore = ratedItems.reduce((sum, item) => sum + (results[item.id]?.rating || 0), 0);
  const averageScore = ratedItems.length > 0 ? (totalScore / ratedItems.length).toFixed(2) : "N/A";

  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text(`Average Rating: ${averageScore} / 4`, 14, 55);

  const tableData = rubric.map(item => {
    const result = results[item.id];
    const star = result?.starEvidence;
    const starStr = star 
      ? `S: ${star.situation}\nT: ${star.task}\nA: ${star.action}\nR: ${star.result}`
      : 'No evidence extracted.';

    return [
      item.competency,
      item.parameter,
      result?.rating || '-',
      starStr
    ];
  });

  autoTable(doc, {
    startY: 65,
    head: [['Competency', 'Parameter', 'Score', 'STAR Evidence']],
    body: tableData,
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 30 },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 'auto', fontSize: 8 }
    },
    headStyles: {
      fillColor: [30, 64, 175]
    },
    styles: {
      overflow: 'linebreak'
    }
  });

  doc.save(`${settings.candidateName.replace(/\s+/g, '_')}_STAR_Report.pdf`);
};
