import * as math from 'mathjs';
import { Float32Vector, Table, Dictionary } from 'apache-arrow';
import { col } from 'apache-arrow/compute/predicate';
import * as assert from 'assert';

export function pressure_psia2dbar(p: number) {
    // Function to convert pressure in psia to dbar
    // p - pressure in psia
    return (p - 14.7) * 0.689476
}

export function pressure(df: Table, colName: string, colName2: string, c: Object): any {
    /*
        Pressure calcuation using A/D counts for Seabird 19plusV2

        Sample calibration coefficients for pressure calculation:

        {"PressureSensor":{"SerialNumber":5048,"CalibrationDate":"03-Mar-16","PA0":-7.76405289,
        "PA1":0.0156780081,"PA2":-6.48466876e-10,"PTEMPA0":-63.7429865,"PTEMPA1":51.7986913,
        "PTEMPA2":-0.226510802,"PTCA0":524405.088,"PTCA1":-22.4344595,"PTCA2":0.0108628644,
        "PTCB0":24.74475,"PTCB1":-0.00245,"PTCB2":0,"Offset":0}}
    */

    console.info(`pressure schema: ${df.schema.fields.map(x => x.name)}`)

    let p = new Float32Array(df.length);
    let counts: any = null, temp_counts: any = null;
    let y: number = null, t: number = null, x: number = null, n: number = null, pTemp: number = null;
    df.scan((idx) =>{
        y = temp_counts(idx);
        t = c["PTEMPA0"] + c["PTEMPA1"] * y + c["PTEMPA2"] * y;
        x = counts(idx) - c["PTCA0"] - c["PTCA1"] * t - c["PTCA2"] * t ** 2;
        n = x * c["PTCB0"] / (c["PTCB0"] + c["PTCB1"] * t + c["PTCB2"] * t ** 2)
        pTemp = c["PA0"] + c["PA1"] * n + c["PA2"] * n ** 2;
        p[idx] = pressure_psia2dbar(pTemp);
        // p[idx] = pTemp;
    }, (batch) => {
        counts = col(colName).bind(batch);
        // temp_counts = col(colName2).bind(batch);
        temp_counts = col("Temperature A/D Counts").bind(batch);
    });
    // console.info(`pressure: ${p.slice(-3)}`);
    let newCol: string = "Pressure (decibars)";
    df = df.assign(Table.new([Float32Vector.from(p)], [newCol]));
    return df;
}

export function mv(n: number): number {
    // mv - used as part of Seabird 19plusV2 Temperature calculation
    return (n - 524288) / 1.6e+007;
}

export function r(mv: number): number {
    // r - used as part of Seabird 19plusV2 Temperature calculation
    return (mv * 2.900e+009 + 1.024e+008) / (2.048e+004 - mv * 2.0e+005);
}

export function temperature(df: Table, colName: string, c: Object): any {
    /* 
        Calculate the temperature (degC) from temperature A/D counts
    */
    let t90 = new Float32Array(df.length);
    let v: any = null;
    let temp: number = null;
    df.scan((idx) =>{
        temp = mv(v(idx));
        temp = r(temp);
        t90[idx] = ( (1 / ( c['A0'] + 
                        (c['A1'] * Math.log(temp)) + 
                        (c['A2'] * (Math.log(temp) ** 2)) + 
                        (c['A3'] * (Math.log(temp) ** 3)) ) ) - 273.15) *
                        c['Slope'] + c['Offset']; 
    }, (batch) => {
        v = col(colName).bind(batch);
    });
    let newCol: string = "Temperature (degC)";
    df = df.assign(Table.new([Float32Vector.from(t90)], [newCol]));
    return df;
}

export function temp_test() {

    let c = {
        "A0": 1.231679e-003,
        "A1": 2.625697e-004,
        "A2": -1.890234e-007,
        "A3": 1.542035e-007,
        "Slope": 1,
        "Offset": 0
    };
    let adCounts = new Float32Array(
        [675144.889, 601930.644, 417997.356, 368087.000, 299977.133, 247872.489, 216297.333]);
    let correctOutputs = new Float32Array(
        [1.0000, 4.4999, 15.0002, 18.4999, 23.9999, 29.0000, 32.5000]
    );
    let colName = "Temperature A/D Counts";
    let df = Table.new([Float32Vector.from(adCounts)], [colName]);

    df = temperature(df, colName, c);
    console.info(`temp: ${df.getColumn('Temperature (degC)').toArray()}`)
    let outputs = df.getColumn('Temperature (degC)').toArray();
    let precision: number = 3;
    outputs.forEach(function (value, idx) {
        console.info(`${idx} > ${value.toFixed(4)} ==? ${correctOutputs[idx]}`);
        // assert(value.toFixed(precision) === correctOutputs[idx], `temperature unit test failed, ${value.toFixed(precision)} !== ${correctOutputs[idx]}`);
    });

}

export function temp_pressure() {

    let c = {
        "PA0": -7.764053e+000,
        "PA1": 1.567801e-002,
        "PA2": -6.484669e-010,
        "PTEMPA0": -6.374299e+001,
        "PTEMPA1": 5.179869e+001,
        "PTEMPA2": -2.265108e-001,    
        "PTCA0": 5.244051e+005,
        "PTCA1": -2.243446e+001,
        "PTCA2": 1.086286e-002,
        "PTCB0": 2.474475e+001,
        "PTCB1": -2.450000e-003,
        "PTCB2": 0.000000e+000 
    }
    let counts = new Float32Array(
        [525336.8, 589897.9, 654847.6, 720155.1, 785813.8, 851830.2, 785809.9,
            720174.8, 654847.3, 589895.3, 525323.6]);
    let voltages = new Float32Array(Array(counts.length).fill(1.7));
    let colName = "Pressure A/D Counts";
    let colName2 = "Pressure Temperature Compensation Voltage";
    let df = Table.new([Float32Vector.from(counts),
                        Float32Vector.from(voltages)], 
                        [colName, colName2]);
    df = pressure(df, colName, colName2, c);
    let tempArray = df.getColumn('Pressure (decibars)').toArray().slice(-3);
    console.info(`pressure: ${tempArray}`);

}

// temp_test();
temp_pressure();

