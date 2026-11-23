'use strict';
// Pin map of the PicoBoy Color Plus, from the book library (pbc_geraet.c)
// and pbc-plus/docs/HARDWARE.md. Each entry: [name, note] in English and German.
const PINS = {
    0: { en: ['Joystick centre', 'active LOW with pull-up. UART0 TX would be here too – that is why the serial port (UART) stays off.'],
         de: ['Joystick Mitte', 'aktiv LOW mit Pullup. Hier läge auch UART0 TX – deshalb bleibt die serielle Schnittstelle (UART) aus.'] },
    1: { en: ['Joystick right', 'active LOW with pull-up. UART0 RX would be here too – that is why the serial port (UART) stays off.'],
         de: ['Joystick rechts', 'aktiv LOW mit Pullup. Hier läge auch UART0 RX – deshalb bleibt die serielle Schnittstelle (UART) aus.'] },
    2: { en: ['Joystick down', 'active LOW with pull-up'], de: ['Joystick runter', 'aktiv LOW mit Pullup'] },
    3: { en: ['Joystick left', 'active LOW with pull-up'], de: ['Joystick links', 'aktiv LOW mit Pullup'] },
    4: { en: ['Joystick up', 'active LOW with pull-up'], de: ['Joystick hoch', 'aktiv LOW mit Pullup'] },
    8: { en: ['Display DC', 'data/command select of the ST7789'], de: ['Display DC', 'Daten/Befehl-Umschaltung des ST7789'] },
    9: { en: ['Display RST', 'reset of the ST7789'], de: ['Display RST', 'Reset des ST7789'] },
    10: { en: ['Display CS', 'plain GPIO, not the SPI chip select'], de: ['Display CS', 'normaler GPIO, nicht der CS-Pin des SPI'] },
    11: { en: ['RGB LED', 'WS2812 in the “+” of the logo, driven by PIO'], de: ['RGB-LED', 'WS2812 im „+“ des Schriftzugs, angesteuert über PIO'] },
    12: { en: ['Green LED', 'active HIGH'], de: ['LED grün', 'aktiv HIGH'] },
    13: { en: ['Yellow LED', 'active HIGH'], de: ['LED gelb', 'aktiv HIGH'] },
    14: { en: ['Red LED', 'active HIGH'], de: ['LED rot', 'aktiv HIGH'] },
    15: { en: ['Speaker', 'PWM through an RC low-pass (channel B of the PWM slice)'], de: ['Lautsprecher', 'PWM über RC-Tiefpass (Kanal B des PWM-Slices)'] },
    18: { en: ['Display SPI SCK', 'SPI0, 62.5 MHz, mode 0'], de: ['Display SPI SCK', 'SPI0, 62,5 MHz, Mode 0'] },
    19: { en: ['Display SPI MOSI', 'SPI0'], de: ['Display SPI MOSI', 'SPI0'] },
    20: { en: ['I2C SDA', 'in use: accelerometer STK8BA58'], de: ['I2C SDA', 'belegt: Beschleunigungssensor STK8BA58'] },
    21: { en: ['I2C SCL', 'in use: accelerometer STK8BA58'], de: ['I2C SCL', 'belegt: Beschleunigungssensor STK8BA58'] },
    26: { en: ['Backlight', 'PWM. Without PWM the screen stays black.'], de: ['Hintergrundlicht', 'PWM. Ohne PWM bleibt der Bildschirm schwarz.'] },
    27: { en: ['Button A', 'active LOW with pull-up'], de: ['Taste A', 'aktiv LOW mit Pullup'] },
    28: { en: ['Button B', 'active LOW with pull-up'], de: ['Taste B', 'aktiv LOW mit Pullup'] },
    29: { en: ['Battery voltage', 'ADC input 3'], de: ['Akkuspannung', 'ADC-Eingang 3'] },
};

function pin(n, language) {
    const p = PINS[n];
    if (!p) return null;
    return (language || '').toLowerCase().startsWith('de') ? p.de : p.en;
}

module.exports = { PINS, pin };
