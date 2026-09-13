/**
 * Contraseñas de 8 caracteres o más que aparecen primero en las filtraciones
 * públicas, más las obvias para este juego. Se comparan en minúsculas.
 *
 * No pretende ser exhaustiva: corta lo que un atacante prueba en los primeros
 * segundos. Para lo demás están el límite de intentos y el hash lento.
 */
const LIST = `
12345678 123456789 1234567890 0123456789 11111111 00000000 88888888 12341234
87654321 11223344 12344321 11112222 123123123 1q2w3e4r 1q2w3e4r5t 1qaz2wsx
qwertyui qwertyuiop qwerty123 qwerty1234 asdfghjk asdfghjkl zxcvbnm1 azertyui
password password1 password12 password123 passw0rd p@ssw0rd p@ssword contraseña
contrasena contraseña1 contrasena1 contraseña123 contrasena123 iloveyou iloveyou1
sunshine princess football baseball welcome1 welcome123 letmein1 trustno1
superman batman123 starwars pokemon1 minecraft fortnite dragon123 monkey123
abc12345 abcd1234 abcdefgh aa123456 a1234567 a12345678 q1w2e3r4 zaq12wsx
teamo123 tequiero boquita1 riverplate bocajuniors messi123 argentina argentina1
mexico123 colombia1 barcelona realmadrid 1234qwer qwer1234 asdf1234 changeme
administrator admin123 admin1234 master123 computer internet whatever
flagazo flagazo1 flagazo123 flagazo2026 banderas banderas1 bandera123
`;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean));
