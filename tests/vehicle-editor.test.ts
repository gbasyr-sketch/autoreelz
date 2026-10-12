import test from 'node:test';import assert from 'node:assert/strict';
import {blankVehicle,normalizeVehicle,normalizeVersion,selectFitmentVehicle,selectFitmentVersion,vehicleName} from '../src/lib/vehicle-editor.ts';
const data=()=>({...blankVehicle(),make:'Лада',model:'Гранта',name:'Лада Гранта'});
test('vehicle fields normalize spaces and leave unknown dates empty',()=>{const d=normalizeVehicle({...data(),name:'  Лада   Гранта  ',generation:' FL '});assert.equal(d.name,'Лада Гранта');assert.equal(d.yearFrom,'');assert.equal(d.generation,'FL');assert.equal(vehicleName(d),'Лада Гранта FL');});
test('vehicle validation rejects missing identity, control characters and invalid or reversed years',()=>{for(const change of [{name:''},{make:''},{model:''},{generation:'x'.repeat(101)},{name:'A\nB'},{yearFrom:'1969'},{yearTo:'2101'},{yearFrom:'2020',yearTo:'2019'},{yearFrom:'20xx'}])assert.throws(()=>normalizeVehicle({...data(),...change}));});
test('version requires a vehicle and keeps notes as plain text',()=>{const v=normalizeVersion({vehicleId:'12345678-1234-1234-1234-123456789012',name:' Люкс ',note:' A\r\nB '});assert.equal(v.name,'Люкс');assert.equal(v.note,'A\nB');for(const change of [{vehicleId:''},{name:''},{note:'x'.repeat(2001)}])assert.throws(()=>normalizeVersion({...v,...change}));});
test('new selection never copies confirmed fitment to another car or modification',()=>{
 const row={vehicleId:'old',versionId:'v1',yearFrom:'2010',yearTo:'2014',ac:'yes',state:'compatible',note:'Проверить комплектацию'};
 const before={...row};selectFitmentVehicle(row,'old');assert.deepEqual(row,before);selectFitmentVehicle(row,'new');assert.equal(row.versionId,'');assert.equal(row.state,'unknown');assert.equal(row.yearFrom,'2010');assert.equal(row.note,before.note);
 row.state='compatible';selectFitmentVersion(row,'v2');assert.equal(row.state,'unknown');assert.equal(row.ac,'yes');row.state='incompatible';selectFitmentVersion(row,'v2');assert.equal(row.state,'incompatible');
});
