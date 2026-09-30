"""Owner-facing PDF. Run with the bundled Python/reportlab runtime from repo root."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/AUTO-REELZ-instruktsiya-dobavlenie-tovarov.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Manrope', str(ROOT/'public/fonts/manrope-0.ttf')))
pdfmetrics.registerFont(TTFont('ManropeBold', str(ROOT/'public/fonts/manrope-3.ttf')))
pdfmetrics.registerFontFamily('Manrope', normal='Manrope', bold='ManropeBold')
W, H = A4
M, CW = 42, W-84
INK, MUTED, RED = '#20211F', '#64655F', '#CB181A'
LINE, WASH = '#DDDED7', '#F5F5F1'
c = canvas.Canvas(str(OUT), pagesize=A4, pageCompression=1)
c.setTitle('AUTO REELZ: добавление и редактирование товаров')
c.setAuthor('AUTO REELZ')
c.setSubject('Инструкция владельцу по единой форме товара, версия 30.09.2026')
page = 0
y = 0

def para(text, x, top, width, size=10.2, leading=15.3, color=INK, bold=False):
    style = ParagraphStyle('p', fontName='ManropeBold' if bold else 'Manrope', fontSize=size,
                           leading=leading, textColor=HexColor(color), splitLongWords=False,
                           spaceBefore=0, spaceAfter=0)
    p = Paragraph(text, style)
    _, height = p.wrap(width, 1000)
    if top+height > H-48:
        raise ValueError(f'Page {page}: content overflow at {top+height:.1f}: {text[:80]}')
    p.drawOn(c, x, H-top-height)
    return height

def block(text, size=10.2, after=11, bold=False, color=INK):
    global y
    y += para(text, M, y, CW, size=size, leading=size*1.5, bold=bold, color=color)+after

def title(kicker, heading, subtitle=''):
    global page, y
    if page:
        c.showPage()
    page += 1
    c.setFillColor(HexColor(INK)); c.setFont('ManropeBold', 11)
    c.drawString(M, H-32, 'AUTO')
    c.setFillColor(HexColor(RED)); c.drawString(M+37, H-32, 'REELZ')
    c.setFillColor(HexColor(MUTED)); c.setFont('Manrope', 8)
    c.drawRightString(W-M, H-32, 'РУКОВОДСТВО ВЛАДЕЛЬЦУ')
    c.setStrokeColor(HexColor(LINE)); c.line(M, H-44, W-M, H-44)
    c.setFont('Manrope', 8); c.setFillColor(HexColor(MUTED))
    c.drawString(M, 26, 'autoreelz.ru  •  Версия 30.09.2026')
    c.drawRightString(W-M, 26, f'{page} / 6')
    c.bookmarkPage(f'page-{page}'); c.addOutlineEntry(heading, f'page-{page}')
    y = 65
    block(kicker.upper(), size=9, color=RED, after=9, bold=True)
    block(heading, size=24, after=10, bold=True)
    if subtitle:
        block(subtitle, size=10.6, color=MUTED, after=18)

def h2(text):
    block(text, size=14.2, after=9, bold=True)

def note(text, bg='#FFF1EF', accent=RED):
    global y
    style=ParagraphStyle('note', fontName='Manrope', fontSize=9.8, leading=14.6, textColor=HexColor(INK))
    p=Paragraph(text, style); _, height=p.wrap(CW-32,1000)
    c.setFillColor(HexColor(bg)); c.roundRect(M,H-y-height-24,CW,height+24,7,fill=1,stroke=0)
    c.setFillColor(HexColor(accent));c.rect(M,H-y-height-24,3,height+24,fill=1,stroke=0)
    para(text,M+16,y+12,CW-32,size=9.8,leading=14.6)
    y += height+38

def step(number, heading, text):
    global y
    c.setFillColor(HexColor('#FFF0EF'));c.circle(M+12,H-y-12,12,fill=1,stroke=0)
    c.setFillColor(HexColor(RED));c.setFont('ManropeBold',10);c.drawCentredString(M+12,H-y-15.5,str(number))
    height=para(heading,M+36,y,CW-36,size=11,leading=16,bold=True)
    height += 5+para(text,M+36,y+height+5,CW-36,size=10,leading=15)
    y += max(height,24)+16

def table(headers, rows, widths=None):
    global y
    widths=widths or [CW/len(headers)]*len(headers)
    for idx,row in enumerate([headers]+rows):
        head=idx==0
        heights=[]
        for text,width in zip(row,widths):
            p=Paragraph(text,ParagraphStyle('cell',fontName='ManropeBold' if head else 'Manrope',fontSize=9.3,leading=13.7))
            heights.append(p.wrap(width-20,1000)[1])
        height=max(heights)+20
        if y+height>H-48:
            raise ValueError(f'Page {page}: table overflow')
        c.setFillColor(HexColor('#EDEEE8' if head else ('#F8F8F5' if idx%2 else '#FFFFFF')))
        c.rect(M,H-y-height,CW,height,fill=1,stroke=0)
        x=M
        for text,width in zip(row,widths):
            para(text,x+10,y+10,width-20,size=9.3,leading=13.7,bold=head)
            x+=width
        c.setStrokeColor(HexColor(LINE));c.setLineWidth(.45);c.line(M,H-y-height,M+CW,H-y-height)
        y+=height
    y+=16

def screen(path, crop, width, caption):
    """Clip an existing screenshot on the PDF page; do not alter its pixels."""
    global y
    source=ImageReader(str(ROOT/path));iw,ih=source.getSize()
    left,top,cropw,croph=crop;scale=width/cropw;height=croph*scale
    x=M+(CW-width)/2
    c.saveState();p=c.beginPath();p.rect(x,H-y-height,width,height);c.clipPath(p,stroke=0,fill=0)
    c.drawImage(source,x-left*scale,H-y-height-(ih-top-croph)*scale,width=iw*scale,height=ih*scale)
    c.restoreState();c.setStrokeColor(HexColor(LINE));c.rect(x,H-y-height,width,height,fill=0,stroke=1)
    y+=height+8
    y+=para(caption,M,y,CW,size=8.3,leading=12.2,color=MUTED)+16

def boxes(items):
    global y
    gap=10;size=(CW-gap*(len(items)-1))/len(items)
    for i,(label,value) in enumerate(items):
        x=M+i*(size+gap)
        c.setFillColor(HexColor(WASH));c.roundRect(x,H-y-74,size,74,7,fill=1,stroke=0)
        para(label,x+12,y+12,size-24,size=9,leading=13,color=MUTED)
        para(value,x+12,y+34,size-24,size=17,leading=24,bold=True)
    y+=91

def checks(items):
    global y
    for text in items:
        c.setStrokeColor(HexColor('#898B82'));c.setLineWidth(.8);c.roundRect(M,H-y-12,10,10,1,fill=0,stroke=1)
        height=para(text,M+22,y-2,CW-22,size=10,leading=15)
        y+=max(height,13)+11
    y+=5

title('01 / Начало', 'Как добавить товар', 'Одна форма: от названия и фотографий до цены, упаковки и публикации.')
block('<b>Откройте кабинет:</b> <link href="https://autoreelz.ru/manager/products" color="#CB181A">autoreelz.ru/manager/products</link><br/>Войдите выданным аккаунтом администратора и нажмите <b>«+ Добавить товар»</b>.')
screen('artifacts/product-editor/public/new-product.png',(243,239,866,500),CW,
       'Блок «Основное» в действующей форме добавления товара.')
h2('Подготовьте перед заполнением')
block('Название и категорию, фотографии, описание, артикулы вариантов, цены в рублях, фактическое количество и замеры упакованного товара.')
note('<b>Сначала проверьте, нет ли товара в каталоге.</b> Часть ассортимента уже перенесена из Wildberries. Существующую карточку нужно редактировать, а не создавать заново.')
block('<b>Порядок работы:</b> основные данные → фото → варианты и цена → упаковка → проверка → публикация.',size=10)

title('02 / Карточка', 'Название и фотографии', 'Покажите покупателю сам товар, его детали и комплектность.')
step(1,'Заполните блок «Основное»','Укажите понятное название, выберите категорию и добавьте описание: назначение товара, состав поставки и важные условия установки. Совместимость и преимущества описывайте только по подтверждённым данным.')
step(2,'Нажмите «Выбрать фотографии»','Можно загрузить JPG, PNG или WebP: до 10 МБ и 24 мегапикселей на файл, до 12 фотографий в одной галерее. Дождитесь сообщения об успешной загрузке.')
step(3,'Выберите главное фото и порядок','Первое фото становится главным. Перемещайте карточки мышью или стрелками. В поле «Подпись» кратко опишите изображение. Кнопка «Убрать» удаляет фото из галереи товара.')
h2('Рекомендуемый порядок галереи')
table(['Место','Что показать'],[
 ['1. Главное','Товар целиком, без обрезанных краёв. Лучше использовать спокойный фон.'],
 ['2. Другой ракурс','Задняя или боковая сторона изделия.'],
 ['3. Детали','Разъёмы, крепления, поверхность, подсветка.'],
 ['4. Комплектность','Всё, что входит в поставку.'],
 ['5. В салоне','Реальное фото установленного изделия, если оно есть.'],
], [135,CW-135])
note('<b>Общие фото нужны даже при разных цветах товара.</b> Они показываются в каталоге. Собственные фотографии варианта можно добавить в его дополнительном блоке; они заменяют общую галерею для выбранного варианта.',bg='#F0F4EE',accent='#44634A')
block('Количество фотографий выше - рекомендация. Не нужно добавлять одинаковые кадры только ради заполнения всех мест.',size=9.5,color=MUTED)

title('03 / Варианты и цена', 'Один товар - несколько вариантов', 'Каждое исполнение имеет свой артикул, цену и остаток.')
boxes([('Товар','Общая карточка'),('Вариант 1','Зелёная'),('Вариант 2','Красная')])
block('Схема условная: это пример двух вариантов подсветки, а не указание создавать такие исполнения для каждого изделия.')
step(4,'Заполните блок «Цена и варианты»','В форме уже есть один вариант. Если исполнение единственное, можно дать ему понятную подпись «Стандартное исполнение». Для других цветов или исполнений нажмите <b>«+ Добавить вариант»</b>.')
table(['Поле','Что вводить'],[
 ['Название варианта','Реальное отличие: например, цвет подсветки или вид поверхности.'],
 ['Артикул','Ваш фактический уникальный артикул. Не перенумеровывайте существующие товары.'],
 ['Цена, ₽','Рубли: <b>1800</b> означает <b>1 800 ₽</b>. Для дробной цены допустимо <b>1800,50</b>.'],
 ['Показывать на сайте','«Да, после публикации товара», «Пока черновик» или «Архив».'],
 ['Начальный остаток, шт.','Фактическое количество нового исполнения. При 0 оно доступно как предзаказ.'],
 ['Причина прихода','Обязательна при количестве больше нуля. Например, «Первичный подсчёт».'],
], [145,CW-145])
note('<b>Начальный остаток учитывается один раз при публикации.</b> Сохранение черновика не делает приход. У существующего исполнения вместо этого поля показываются складские числа и ссылка «Изменить остаток».')
block('Не создавайте новую карточку, если нужно только добавить вариант уже существующего товара: откройте её кнопкой «Редактировать».',size=9.5,color=MUTED)

title('04 / Доставка', 'Упаковка без пересчёта вручную', 'В новой форме размеры вводятся в сантиметрах, масса - в граммах.')
step(5,'Раскройте «Упаковка для доставки»','Измерьте внешние размеры готовой посылки и массу товара вместе с упаковкой. Заполните все четыре поля. Для одинаковой упаковки есть кнопка <b>«Применить эту упаковку ко всем вариантам»</b>.')
h2('Пример заполнения')
boxes([('Вес, г','200'),('Длина, см','22'),('Ширина, см','10'),('Высота, см','4')])
block('Это пример по ранее переданным размерам блока отопителя. Для нового товара используйте его собственные замеры; существующую карточку «гранта зеленая» повторно создавать не нужно.')
note('<b>В новой форме: 22 × 10 × 4 см и 200 г.</b><br/>В CMS те же размеры вводятся в миллиметрах: 220 × 100 × 40 мм. Новая форма переводит единицы автоматически.')
h2('Если упаковка неизвестна')
block('Оставьте черновик неполным. Без упаковки расчёт СДЭК может перейти на ручное уточнение. Не подставляйте приблизительные размеры или нулевую доставку.')
h2('Как менять остаток после публикации')
table(['Ситуация','Что делать в разделе «Склад»'],[
 ['Поступила новая партия','<b>«Приход»</b>: введите, сколько единиц добавилось, и причину. Было 7, поступило 3 - станет 10.'],
 ['Провели пересчёт','<b>«Остаток»</b>: введите полный фактический запас. Если всего нашли 9 единиц, укажите 9.'],
], [160,CW-160])
block('Числа в примерах учебные. Свободное количество = физический остаток минус резерв. Уменьшить физический остаток ниже действующего резерва нельзя.',size=9.5,color=MUTED)

title('05 / Завершение', 'Проверьте и опубликуйте', 'Черновик и публикация - два разных действия.')
step(6,'При необходимости заполните дополнительные блоки','В <b>«Характеристики и совместимость»</b> укажите подтверждённые признаки. Неизвестные годы оставляйте пустыми, статус - «Не подтверждено». Приора 1 и Приора 2 выбираются отдельно. Особые фото и правила варианта находятся внутри его дополнительного блока.')
block('В <b>«Адрес страницы и SEO»</b> проверьте предложенный адрес, при необходимости заполните SEO-заголовок и краткое описание для поиска. Для настоящего товара признак «Демонстрационный товар» должен быть выключен.')
table(['Кнопка','Результат'],[
 ['Сохранить черновик','Можно заполнить не всё. Черновик появится над списком товаров. У уже опубликованного товара посетители продолжают видеть прежнюю версию.'],
 ['Опубликовать','Готовые данные появляются на сайте. Начальный приход новых исполнений учитывается один раз. Ошибки и недостающие обязательные поля будут отмечены.'],
], [155,CW-155])
h2('Перед нажатием «Опубликовать»')
checks([
 'Проверены название, адрес и опубликованная категория с родительскими разделами.',
 'Есть общая фотография и хотя бы один готовый вариант с артикулом и положительной ценой.',
 'Варианты, фото, характеристики и совместимость соответствуют реальному товару.',
 'Упаковка измерена, начальное количество введено по факту, причина прихода заполнена.',
])
step(7,'Откройте товар на сайте','После публикации нажмите <b>«Открыть на сайте»</b>. Проверьте фото, варианты, цену и наличие; добавьте нужный вариант в корзину. Посмотрите карточку с телефона. Создавать заказ ради этой проверки не требуется.')
block('Главная показывает подборку, а не весь ассортимент. Новую карточку прежде всего проверяйте в каталоге. Магазин пока работает в тестовом режиме оплаты.',size=9.5,color=MUTED)

title('06 / На каждый день', 'Редактирование и помощь', 'Сохраните эту страницу как короткую памятку.')
block('<b>Изменить товар:</b> «Товары» → нужная карточка → «Редактировать».<br/><b>Изменить количество:</b> «Склад» → нужный артикул → «Приход» или «Остаток».<br/><b>Продолжить позже:</b> выберите сохранённый черновик над списком товаров.')
table(['Что произошло','Что проверить'],[
 ['Товара нет в каталоге','Опубликованы ли товар, вариант и категория с родителями. Снимите фильтры каталога.'],
 ['Показывается предзаказ','Проверьте свободный остаток именно этого артикула, включая резерв.'],
 ['Ошибка связи при сохранении','Данные остаются в форме. Повторите действие с теми же данными; не создавайте товар заново.'],
 ['Конфликт с другой вкладкой или CMS','Сравните изменения. При необходимости используйте «Сбросить черновик и загрузить карточку». После подтверждения правки формы будут удалены, опубликованный товар и склад сохранятся.'],
], [152,CW-152])
h2('Готовые комплекты пока создаются в CMS')
block('В CMS откройте «Товары» → «Создать», выберите вид <b>«Готовый комплект»</b>. Заполните карточку и фото. В «Состав комплекта» добавьте конкретные существующие исполнения и их количество, при необходимости укажите скидку комплекта в процентах.')
block('Цена и наличие рассчитываются из состава. Собственный склад и отдельное исполнение комплекта не создаются. Проверьте состав, упаковку и публикацию карточки.',after=15)
table(['Полезные ссылки','Адрес'],[
 ['Товары и черновики','<link href="https://autoreelz.ru/manager/products" color="#CB181A">autoreelz.ru/manager/products</link>'],
 ['Склад','<link href="https://autoreelz.ru/manager/stock" color="#CB181A">autoreelz.ru/manager/stock</link>'],
 ['CMS','<link href="https://autoreelz.ru/cms/admin" color="#CB181A">autoreelz.ru/cms/admin</link>'],
], [152,CW-152])
assert page==6
c.save()
print(OUT)
