// Literal Off-Grid Price Book items (QA finding U7: "Pull prices from the Price Book by selected item").
// Source: the Managing Director's browser reference build reservia_deal_engine.html, DATA.items,
// categories 'Lithium Batteries' and 'Solar Inverter' (stamped "Rev05/R74 seed", 2026-11-04) - the
// same Rev05 Off_Grid.xlsx price list the Off-Grid form previously had typed in by hand. Off-grid
// inverters are the MUST stand-alone/hybrid units with a stated kW rating (n1); batteries carry
// nominal voltage (n1, V) and capacity (n2, Ah). Loaded into CommercialMaterialItem by
// scripts/seedCommercialOffGridItems.js (insert-only - never overwrites a price someone edited).

'use strict';

const SOURCE = { sourceWorkbook: 'reservia_deal_engine.html (Rev05/R74 seed)', effectiveDate: '2026-11-04' };

const LITHIUM_BATTERIES = [
  {brand: "Newmox",model: "Newmax 8S1P Warranty 7 Years",spec: "25.6V 100A",unit: "pcs",price: 27500,n1: 25.6,n2: 100},
  {brand: "Newmox",model: "Newmax 8S1P Warranty 7 Years",spec: "25.6V 230A",unit: "pcs",price: 47000,n1: 25.6,n2: 230},
  {brand: "Newmox",model: "Newmax 16S1P Warranty 7 Years",spec: "51.2V 100A",unit: "pcs",price: 46500,n1: 51.2,n2: 100},
  {brand: "Newmox",model: "Newmax 16S1P Warranty 7 Years",spec: "51.2V 230A",unit: "pcs",price: 95000,n1: 51.2,n2: 230},
  {brand: "Newmox",model: "Newmax 16S1P Warranty 7 Years",spec: "51.2V 314A",unit: "pcs",price: 110000,n1: 51.2,n2: 314},
  {brand: "MUST",model: "LP16-24100",spec: "25.6V, 100A, 6000 Cycle, DOD:80%",unit: "pcs",price: 28300,n1: 25.6,n2: 100},
  {brand: "MUST",model: "LP16-24200",spec: "25.6V, 200A, 6000 Cycle, DOD:80%",unit: "pcs",price: 52950,n1: 25.6,n2: 200},
  {brand: "MUST",model: "LP16-48100",spec: "51.2V, 100A, 6000 Cycle, DOD:80%",unit: "pcs",price: 47500,n1: 51.2,n2: 100},
  {brand: "MUST",model: "LP16-48200",spec: "51.2V, 200A, 6000 Cycle, DOD:80%",unit: "pcs",price: 93950,n1: 51.2,n2: 200},
];

const OFF_GRID_INVERTERS = [
  {brand: "MUST",model: "PV18-1612 ECO",spec: "Pure sine wave solar inverter 1.6kw, 12Vdc, 1.6kva, 220Vac 50Hz with inside MPPT 80A charger controller, Dual Output",unit: "pcs",price: 10750,n1: 1.6,n2: null},
  {brand: "MUST",model: "PV18-2024 VPK",spec: "Pure sine wave solar inverter 2kw, 24Vdc, 2kva , 220VAC 50HZ, with inside PWM solar charger controller 50A",unit: "pcs",price: 8630,n1: 2,n2: null},
  {brand: "MUST",model: "PH18-3024 PRO",spec: "ON/OFF grid solar inverter 3kw ,24 Vdc, 3kva, 220VAC 50HZ, inside MPPT solar charger controller 80A",unit: "pcs",price: 17782,n1: 3,n2: null},
  {brand: "MUST",model: "PV18-3624 ECO",spec: "Pure sine wave inverter 3.6kw, 24Vdc, 3.6kva, 220Vac 50Hz with inside MPPT 100A charger controller, Dual Output",unit: "pcs",price: 13000,n1: 3.6,n2: null},
  {brand: "MUST",model: "PV19-4024 EXP",spec: "Pure sine wave inverter 4kw, 24Vdc, 4kva, 220Vac 50Hz with inside MPPT 100A charger controller",unit: "pcs",price: 19758,n1: 4,n2: null},
  {brand: "MUST",model: "PV18-5048 VPK",spec: "Pure sine wave solar inverter 5kw, 48Vdc, 5kva , 220Vac 50HZ, with inside PWM solar charger controller 60A",unit: "pcs",price: 19394,n1: 5,n2: null},
  {brand: "MUST",model: "PV18-5048 VHM",spec: "Pure sine wave solar inverter 5kw, 48Vdc, 5kva, 220VAC,50HZ, with inside MPPT charger controller 80A",unit: "pcs",price: 20484,n1: 5,n2: null},
  {brand: "MUST",model: "PV18-5548 ECO",spec: "Pure sine wave inverter 5.5kw, 48Vdc, 5.5kva, 220Vac 50Hz with inside MPPT 100A charger controller, Dual Output",unit: "pcs",price: 18100,n1: 5.5,n2: null},
  {brand: "MUST",model: "PV18-6048 ECO",spec: "Pure sine wave inverter 6kw, 48Vdc, 6kva, 220Vac 50Hz with inside MPPT 120A charger controller, Dual Output",unit: "pcs",price: 18650,n1: 6,n2: null},
  {brand: "MUST",model: "PV19-6048 EXP",spec: "Pure sine wave inverter 6kw, 48Vdc, 6kva, 220Vac 50Hz with inside MPPT 120A charger controller",unit: "pcs",price: 26444,n1: 6,n2: null},
  {brand: "MUST",model: "PV19-8048 EXP",spec: "Pure sine wave inverter 8kw, 48Vdc, 8kva, 220Vac 50Hz with inside MPPT 120A charger controller",unit: "pcs",price: 37700,n1: 8,n2: null},
  {brand: "MUST",model: "PV19-10048 EXP",spec: "Pure sine wave inverter 10kw, 48Vdc, 10kva, 220Vac 50Hz with inside MPPT 120A charger controller",unit: "pcs",price: 39999,n1: 10,n2: null},
  {brand: "MUST",model: "PV19-12048 EXP",spec: "Pure sine wave inverter 12kw, 48Vdc, 12kva, 220Vac 50Hz with inside MPPT 150A charger controller",unit: "pcs",price: 45999,n1: 12,n2: null},
];

module.exports = { SOURCE, LITHIUM_BATTERIES, OFF_GRID_INVERTERS };
