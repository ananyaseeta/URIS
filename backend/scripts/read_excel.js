'use strict';
const xlsx = require('xlsx');

try {
  const filePath = 'C:\\Users\\Ananya Seeta\\Downloads\\Copy of Employee sheet.xlsx';
  const workbook = xlsx.readFile(filePath);
  console.log('Sheet Names:', workbook.SheetNames);
  
  const sheet1Data = xlsx.utils.sheet_to_json(workbook.Sheets['Sheet1']);
  console.log('--- Sheet1 ---');
  console.log(JSON.stringify(sheet1Data, null, 2));

  const sheet2DataRaw = xlsx.utils.sheet_to_json(workbook.Sheets['Sheet2'], { header: 1 });
  console.log('--- Sheet2 ---');
  console.log(JSON.stringify(sheet2DataRaw, null, 2));
} catch (e) {
  console.error('Error reading Excel:', e);
}
