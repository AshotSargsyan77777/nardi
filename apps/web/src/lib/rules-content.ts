/**
 * Human-readable rules. They describe the engine's default rule set; options marked (*) can be
 * changed by the owner (admin panel) or by room hosts where allowed.
 */
export interface RuleSection { title: string; items: string[] }

export const RULES: Record<'hy' | 'ru' | 'en', RuleSection[]> = {
  hy: [
    { title: 'Շաշկի (ռուսական)', items: [
      '8×8 տախտակ, ամեն մեկը 12 քարով, խաղում են միայն մուգ դաշտերում։ Սկսում են սպիտակները։',
      'Քարը գնում ա մեկ դաշտ առաջ՝ անկյունագծով։ Ուտում ա և՛ առաջ, և՛ հետ։',
      'Ուտելը պարտադիր ա, բայց կարող ես ընտրել, թե որով ուտես։ Ուտելը շարունակվում ա, քանի դեռ հնարավոր ա. կերած քարերը հանվում են միայն վերջում, նույն քարը երկու անգամ չի կարելի ուտել։',
      'Վերջին շարքին հասնելով քարը դառնում ա դամկա (նաև ուտելու ժամանակ ու շարունակում ա ուտել որպես դամկա)։ Դամկան գնում ա ցանկացած հեռավորության՝ անկյունագծով։',
      'Ով քայլ չունի, պարտվում ա։ Ոչ-ոքի՝ համաձայնությամբ, նույն դիրքը 3 անգամ կրկնվելով կամ 15 քայլ միայն դամկաներով՝ առանց ուտելու։',
    ] },
    { title: 'Շախմատ', items: [
      'Դասական կանոններ՝ ռոքիրովկա, անցողիկ վերցնել, զինվորի փոխակերպում։',
      'Ամեն խաղացող ունի իր ժամացույցը (օրինակ՝ 5+0 կամ 3+2. րոպեներ + վայրկյաններ ամեն քայլի համար)։ Ժամանակը վերջացավ՝ պարտվում ես (եթե մրցակիցը մատ անելու ֆիգուր չունի՝ ոչ-ոքի)։',
      'Ոչ-ոքի՝ պատ, համաձայնություն, 3 անգամ կրկնություն, 50 քայլ առանց վերցնելու ու զինվորի քայլի, մատ անելու ֆիգուրների բացակայություն։',
      'Կարող ես առաջարկել ոչ-ոքի կամ հանձնվել։ Մրցաշարում ոչ-ոքիի դեպքում առաջ ա անցնում սևերով խաղացողը։',
    ] },
    { title: 'Նարդի. ընդհանուր', items: [
      'Խաղում են երկու հոգի՝ 24 դաշտանոց տախտակի վրա, ամեն մեկը 15 քարով (սպիտակ և սև)։ Զառերը գցում է սերվերը, ու ոչ ոք չի կարող դրանք նախապես իմանալ կամ փոխել։',
      'Քայլը՝ երկու զառի թվերով։ Ամեն զառը առանձին քայլ ա՝ մեկ քարով կամ երկու տարբեր քարով։ Գելեի (նույն թվերի) դեպքում թիվը խաղում ես 4 անգամ։',
      'Պետք ա խաղալ այնքան զառ, որքան հնարավոր ա։ Եթե երկու տարբեր զառից միայն մեկն ա խաղացվում, պետք ա խաղալ մեծը։ Եթե ոչ մի քայլ չկա, հերթն անցնում ա։',
      'Քարերը տուն (վերջին 6 դաշտը) հավաքելուց հետո սկսում ես հանել։ Հանում ես ճիշտ թվով կամ ավելի մեծ զառով՝ ամենահեռու դաշտից, եթե դրանից հետ քար չկա։',
      'Ով առաջինն ա հանում 15 քարը, հաղթում ա պարտիան։ Հաջորդ պարտիան սկսում ա հաղթողը։',
    ] },
    { title: 'Մարս', items: [
      'Եթե հաղթել ես, իսկ մրցակիցը դեռ ոչ մի քար չի հանել, դա մարս ա՝ 2 միավոր 1-ի փոխարեն։',
      'Խաղը շարունակվում ա մինչև ընտրված միավորը (1, 3, 5 կամ 7)․ ամեն պարտիան տալիս ա 1 կամ 2 միավոր։',
    ] },
    { title: 'Կարճ նարդի', items: [
      'Սկզբնական դասավորություն՝ 2 քար 24-ում, 5-ը՝ 13-ում, 3-ը՝ 8-ում, 5-ը՝ 6-ում։ Մրցակիցը նույնն ա, հայելային։',
      'Չի կարելի կանգնել այնտեղ, որտեղ մրցակցի 2 կամ ավելի քար կա։',
      'Եթե մրցակցի մենակ քարի վրա ես կանգնում, այն խփում ես. քարը գնում ա բար (մեջտեղ) ու պետք ա նորից մտնի մրցակցի տնից։ Քանի դեռ բարում քար ունես, ուրիշ քայլ չես անում։',
    ] },
    { title: 'Երկար նարդի', items: [
      'Բոլոր 15 քարը սկսում են «գլխից»՝ տախտակի հակառակ անկյուններից։ Երկուսն էլ շարժվում են նույն ուղղությամբ։',
      'Խփել չկա. չի կարելի կանգնել դաշտում, որտեղ մրցակցի գոնե մեկ քար կա։',
      'Մեկ քայլում գլխից կարելի ա վերցնել միայն մեկ քար։ Բացառություն՝ առաջին քայլի 6-6, 4-4 կամ 3-3, երբ կարելի ա երկու քար։',
      'Չի կարելի իրար հետևից 6 դաշտ փակել, եթե մրցակցի ոչ մի քար դրանից առաջ չկա։',
    ] },
    { title: 'Ինչպես խաղալ կայքում', items: [
      'Սեղմիր «Գցել զառերը»։ Հետո սեղմիր քարը, ապա այն դաշտը, որ ուզում ես (եթե տեղը մեկն ա, քարն ինքը կգնա)։',
      '«Հետ» կոճակով կարող ես փոխել քայլը, «Պատրաստ ա»-ով ուղարկում ես։ Եթե ժամանակը վերջանում ա, սերվերը քո փոխարեն կխաղա։',
      'Տախտակի տակ երևում ա «Փիփ»-ը՝ քանի դաշտ ունի դեռ անցնելու յուրաքանչյուրը։',
    ] },
  ],
  ru: [
    { title: 'Шашки (русские)', items: [
      'Доска 8×8, по 12 шашек, играют на тёмных полях. Начинают белые.',
      'Шашка ходит на одно поле вперёд по диагонали, бьёт и вперёд, и назад.',
      'Бить обязательно, но можно выбрать, чем бить. Бой продолжается, пока возможен; сбитые снимаются в конце, дважды одну шашку бить нельзя.',
      'Дойдя до последнего ряда, шашка становится дамкой (и во время боя — продолжает бить как дамка). Дамка ходит на любое расстояние.',
      'Кто не может ходить — проиграл. Ничья: по согласию, троекратное повторение или 15 ходов только дамками без взятий.',
    ] },
    { title: 'Шахматы', items: [
      'Классические правила: рокировка, взятие на проходе, превращение пешки.',
      'У каждого свои часы (например, 5+0 или 3+2: минуты + секунды за ход). Время вышло — поражение (ничья, если сопернику нечем поставить мат).',
      'Ничья: пат, по согласию, троекратное повторение, 50 ходов без взятий и ходов пешкой, недостаточно материала.',
      'Можно предложить ничью или сдаться. В турнире при ничьей проходит игравший чёрными.',
    ] },
    { title: 'Нарды: общее', items: [
      'Играют двое на доске из 24 пунктов, у каждого 15 шашек (белые и чёрные). Кости бросает сервер, никто не может заранее узнать или изменить их.',
      'Ход — по числам двух костей. Каждая кость — отдельный ход одной шашкой или двумя разными. При дубле число играется 4 раза.',
      'Нужно сыграть столько костей, сколько возможно. Если из двух разных можно сыграть только одну — играется большая. Если ходов нет — ход переходит.',
      'Собрав все шашки в доме (последние 6 пунктов), их выбрасывают с доски точным числом или большей костью с самого дальнего пункта, если дальше шашек нет.',
      'Кто первым выбросит 15 шашек, выигрывает партию. Следующую партию начинает победитель.',
    ] },
    { title: 'Марс', items: [
      'Если соперник не успел выбросить ни одной шашки — это марс: 2 очка вместо 1.',
      'Матч играется до выбранного числа очков (1, 3, 5 или 7).',
    ] },
    { title: 'Короткие нарды', items: [
      'Начальная расстановка: 2 шашки на 24, 5 на 13, 3 на 8, 5 на 6; у соперника зеркально.',
      'Нельзя ставить шашку туда, где 2 и более шашки соперника.',
      'Одиночную шашку соперника можно побить: она уходит на бар и должна снова войти через дом соперника. Пока у тебя шашка на баре, другие ходы нельзя.',
    ] },
    { title: 'Длинные нарды', items: [
      'Все 15 шашек стоят на «голове» в противоположных углах, оба игрока ходят в одном направлении.',
      'Бить нельзя: нельзя ставить шашку на пункт, где есть хоть одна шашка соперника.',
      'С головы за ход можно снять только одну шашку; исключение — 6-6, 4-4 или 3-3 первым броском (две шашки).',
      'Нельзя строить блок из 6 пунктов подряд, если впереди него нет ни одной шашки соперника.',
    ] },
    { title: 'Как играть на сайте', items: [
      'Нажми «Бросить кости». Потом нажми на шашку и на нужный пункт (если вариант один, шашка пойдёт сама).',
      'Кнопкой «Назад» можно переиграть, «Готово» отправляет ход. Если время вышло, сервер сыграет за тебя.',
      'Под доской видно «пипы» — сколько пунктов осталось пройти каждому.',
    ] },
  ],
  en: [
    { title: 'Checkers (Russian draughts)', items: [
      '8×8 board, 12 pieces each, on the dark squares. White starts.',
      'A man moves one square diagonally forward and captures forward and backward.',
      'Capturing is compulsory, but you may choose which capture. A capture goes on while it can; taken pieces come off at the end and none can be jumped twice.',
      'Reaching the far row makes a king (also during a capture, which then continues as a king). Kings move any distance.',
      'A player who cannot move loses. Draws: by agreement, threefold repetition, or 15 moves with only kings and no captures.',
    ] },
    { title: 'Chess', items: [
      'Standard rules: castling, en passant, promotion.',
      'Each player has a clock (e.g. 5+0 or 3+2: minutes + seconds per move). Running out of time loses (a draw if the opponent cannot mate).',
      'Draws: stalemate, agreement, threefold repetition, 50 moves without a capture or pawn move, insufficient material.',
      'You can offer a draw or resign. In a tournament a drawn game goes to the player with black.',
    ] },
    { title: 'Basics', items: [
      'Two players, a 24-point board, 15 checkers each (white and black). The server rolls the dice; nobody can see or change them in advance.',
      'Move by the numbers of the two dice: each die is a separate step, with one checker or two. Doubles are played four times.',
      'Play as many dice as you can. If only one of two different dice can be played, it must be the bigger one. No legal move — the turn passes.',
      'Once all checkers are home (the last 6 points), bear them off with the exact number, or a bigger die from the farthest point if nothing is behind it.',
      'The first to bear off all 15 wins the game. The winner starts the next game.',
    ] },
    { title: 'Mars', items: [
      'If the loser has not borne off a single checker, it is a mars: 2 points instead of 1.',
      'A match is played to the chosen score (1, 3, 5 or 7).',
    ] },
    { title: 'Short nardi', items: [
      'Start: 2 checkers on 24, 5 on 13, 3 on 8, 5 on 6; the opponent mirrored.',
      'You may not land where the opponent has 2 or more checkers.',
      'Landing on a single opponent checker hits it: it goes to the bar and must re-enter in your home. While you have a checker on the bar, you must enter it first.',
    ] },
    { title: 'Long nardi', items: [
      'All 15 checkers start on the «head» in opposite corners; both move the same way round.',
      'No hitting: you may not land on a point with any opponent checker.',
      'Only one checker may leave the head per turn, except 6-6, 4-4 or 3-3 on the first roll (two).',
      'You may not build six points in a row unless an opponent checker is already ahead of it.',
    ] },
    { title: 'Playing on the site', items: [
      'Press «Roll». Then tap a checker and the point you want (with only one choice the checker moves by itself).',
      '«Undo» takes a step back, «Done» sends the move. If time runs out, the server plays for you.',
      'The pip count under each name shows how far each player still has to go.',
    ] },
  ],
};

export const LEGAL: Record<'hy' | 'ru' | 'en', RuleSection[]> = {
  hy: [
    { title: 'Ժամանցային խաղ', items: ['Խաղի մետաղադրամները (վարժանքի չիպեր) անվճար են. դրանք հնարավոր չէ գնել, փոխանակել փողի հետ կամ դուրս բերել։ Իրական գումարով խաղ չկա։'] },
    { title: 'Տարիք և հաշիվ', items: ['Գրանցվելով՝ հաստատում եք, որ ունեք ձեր երկրի օրենքով սահմանված նվազագույն տարիքը։', 'Մեկ անձ՝ մեկ հաշիվ։ Խաբեությունը, համաձայնեցված խաղը և ավտոմատացված ծրագրերը արգելված են։'] },
    { title: 'Պատասխանատու խաղ', items: ['Խաղացեք ժամանցի համար և սահմանեք ժամանակի սահմանափակումներ։', 'Եթե խաղը ազդում է ձեր առօրյայի վրա, դիմեք աջակցության թիմին՝ հաշիվը ժամանակավորապես սահմանափակելու համար։'] },
    { title: 'Տվյալներ', items: ['Մենք պահում ենք միայն ծառայության համար անհրաժեշտ տվյալները։ Խաղում վճարումներ չկան։'] },
  ],
  ru: [
    { title: 'Развлекательная игра', items: ['Игровые монеты (тренировочные фишки) бесплатны: их нельзя купить, обменять на деньги или вывести. Игры на реальные деньги нет.'] },
    { title: 'Возраст и аккаунт', items: ['Регистрируясь, вы подтверждаете, что достигли минимального возраста по закону вашей страны.', 'Один человек — один аккаунт. Мошенничество, сговор и боты запрещены.'] },
    { title: 'Ответственная игра', items: ['Играйте ради удовольствия и ограничивайте время.', 'Если игра мешает вашей жизни, обратитесь в поддержку для временного ограничения аккаунта.'] },
    { title: 'Данные', items: ['Мы храним только необходимые для работы сервиса данные. Платежей в игре нет.'] },
  ],
  en: [
    { title: 'Just for fun', items: ['In-game coins (practice chips) are free: they cannot be bought, exchanged for money or cashed out. There is no real-money play.'] },
    { title: 'Age & account', items: ['By signing up you confirm you meet the minimum legal age in your country.', 'One person, one account. Cheating, collusion and bots are forbidden.'] },
    { title: 'Responsible play', items: ['Play for fun and set yourself time limits.', 'If playing affects your daily life, contact support to restrict your account temporarily.'] },
    { title: 'Data', items: ['We store only the data needed to run the service. There are no payments in the game.'] },
  ],
};
