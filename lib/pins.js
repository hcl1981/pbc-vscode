'use strict';
// Pinbelegung des PicoBoy Color Plus, aus der Buchbibliothek (pbc_geraet.c)
// und pbc-plus/docs/HARDWARE.md.
const PINS = {
    0: ['Joystick Mitte', 'aktiv LOW mit Pullup. Hier läge auch UART0 TX – deshalb bleibt die serielle Schnittstelle (UART) aus.'],
    1: ['Joystick rechts', 'aktiv LOW mit Pullup. Hier läge auch UART0 RX – deshalb bleibt die serielle Schnittstelle (UART) aus.'],
    2: ['Joystick runter', 'aktiv LOW mit Pullup'],
    3: ['Joystick links', 'aktiv LOW mit Pullup'],
    4: ['Joystick hoch', 'aktiv LOW mit Pullup'],
    8: ['Display DC', 'Daten/Befehl-Umschaltung des ST7789'],
    9: ['Display RST', 'Reset des ST7789'],
    10: ['Display CS', 'normaler GPIO, nicht der CS-Pin des SPI'],
    11: ['RGB-LED', 'WS2812 im „+“ des Schriftzugs, angesteuert über PIO'],
    12: ['LED grün', 'aktiv HIGH'],
    13: ['LED gelb', 'aktiv HIGH'],
    14: ['LED rot', 'aktiv HIGH'],
    15: ['Lautsprecher', 'PWM über RC-Tiefpass (Kanal B des PWM-Slices)'],
    18: ['Display SPI SCK', 'SPI0, 62,5 MHz, Mode 0'],
    19: ['Display SPI MOSI', 'SPI0'],
    20: ['I2C SDA', 'belegt: Beschleunigungssensor STK8BA58'],
    21: ['I2C SCL', 'belegt: Beschleunigungssensor STK8BA58'],
    26: ['Hintergrundlicht', 'PWM. Ohne PWM bleibt der Bildschirm schwarz.'],
    27: ['Taste A', 'aktiv LOW mit Pullup'],
    28: ['Taste B', 'aktiv LOW mit Pullup'],
    29: ['Akkuspannung', 'ADC-Eingang 3'],
};

module.exports = { PINS };
