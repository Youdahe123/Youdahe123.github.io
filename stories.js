// Stories behind the photos, keyed by the filename in images/web/.
//
// HOW TO EDIT: find the photo's key below and rewrite `story` in your own
// words. `title` is the small heading above it. A photo with no entry here
// still opens, it just shows the picture with no panel, so you can delete any
// entry you would rather leave blank.
//
// Everything below is a placeholder: it describes what is visible in the
// frame, because only you know what actually happened. Replace them as you go.

const PHOTO_STORIES = {
    // --- recent ---
    IMG_3509: {
        title: 'Yosemite',
        story: 'Sat down on a granite slab and stayed there a while. Nevada Fall is the white thread in the middle distance, and the high country runs back behind it until the haze takes over.',
    },
    IMG_7043: {
        title: 'Up on the girder',
        story: 'Manhattan going gold behind me, traffic moving somewhere underneath, and a very deliberate decision not to look down.',
    },
    IMG_3366: {
        title: 'Matchday',
        story: 'Scotland supporters in full kit and kilts, packed into a corner liquor store before the game. I walked in for something cold and walked out in the team photo.',
    },
    IMG_5165: {
        title: 'Liberty Mutual',
        story: 'The intern cohort under the sign in the lobby, on one of the days somebody remembered to take a picture.',
    },
    IMG_6762: {
        title: 'Out in the sun',
        story: 'A brick side street, a crowd, and the kind of light that makes everyone squint in the photo.',
    },
    IMG_4128: {
        title: 'Museum cafe',
        story: 'A glass of water, a menu I had not read yet, and dried flowers in a stoneware vase.',
    },
    IMG_7195: {
        title: 'Between demos',
        story: 'Sitting beside the monitor against the stone wall, waiting for the next group to come through.',
    },
    IMG_6650: {
        title: 'Badge on',
        story: 'Quarter zip, badge clipped, somewhere between floors.',
    },
    IMG_7102: {
        title: 'Long hallway',
        story: 'Office corridor, headphones in, on the way to somewhere else.',
    },

    // --- travel and street ---
    IMG_6801: {
        title: 'Above the valley',
        story: 'Granite peaks and pines stacked back into the haze.',
    },
    IMG_7049: {
        title: 'Manhattan Bridge',
        story: 'Framed down a cobblestone street in DUMBO, which is exactly where everyone stands to take this picture, and it still works.',
    },
    IMG_3423: {
        title: 'Boston Common',
        story: 'Dusk, a streetlamp flaring against the treeline.',
    },
    IMG_4085: {
        title: 'Christian Science Plaza',
        story: 'The skyline stacked up behind the reflecting pool in summer.',
    },
    IMG_6985: {
        title: 'Green lane',
        story: 'A bike lane running straight up a Manhattan avenue on an overcast morning.',
    },
    IMG_6863: {
        title: 'Wall of icons',
        story: 'Two visitors working their way along a gallery wall.',
    },
    IMG_7073: {
        title: 'Verve',
        story: 'The espresso bar at the roastery, mid afternoon.',
    },
    IMG_9831: {
        title: 'Stage light',
        story: 'A guitarist framed by the screen above the crowd.',
    },
    IMG_6839: {
        title: 'Clipped hedges',
        story: 'Hedges and a flower bed under a very blue sky.',
    },
    IMG_3782: {
        title: 'Golden Gate',
        story: 'From the overlook on a clear afternoon, with the wind doing what it always does up there.',
    },
    IMG_3774: {
        title: 'Japanese Tea Garden',
        story: 'The pagoda in Golden Gate Park, five tiers of it, red against the pines.',
    },
    IMG_3780: {
        title: 'Stone lantern',
        story: 'The pond in the tea garden, a maple going red over the water.',
    },
    IMG_3790: {
        title: 'Washington Square',
        story: 'Twin spires over the lawn, early enough that the park was still mostly empty.',
    },
    IMG_3792: {
        title: 'Chinatown',
        story: 'Lanterns strung the whole length of the street, fire escapes stacked above the shopfronts.',
    },
    IMG_3040: {
        title: 'Bay Bridge',
        story: 'String lights on the terrace, the bridge lit up across the water.',
    },
    IMG_4474: {
        title: 'Waiting to cross',
        story: 'Autumn, a wide crosswalk, everyone facing the same direction.',
    },
    IMG_4486: {
        title: 'The Great Dome',
        story: 'Standing on the lawn in front of the dome at MIT.',
    },
    IMG_4553: {
        title: 'Walk home',
        story: 'A lit path under the trees, brick underfoot, nobody else out.',
    },
    IMG_4813: {
        title: 'Downtown at dawn',
        story: 'Light rail tracks running off into the sunrise, the buildings still lit purple from the night before.',
    },
    IMG_5057: {
        title: 'From the car',
        story: 'People walking the bridge at dusk, the skyline going flat and blue behind them.',
    },
    IMG_2885: {
        title: 'Spring on campus',
        story: 'Tulips out, stone building through the trees.',
    },
    IMG_3708: {
        title: 'Corner cafe',
        story: 'Chalkboard menus, a wall of cold drinks, pastries under glass.',
    },
    IMG_3969: {
        title: 'Out the window',
        story: 'Rooftops running out to the hills, a truck parked in the lot below.',
    },
    IMG_2458: {
        title: 'In the doorway',
        story: 'A dog watching me from the doorway of a wooden shed.',
    },

    // --- work, events, people ---
    IMG_4780: {
        title: 'AfroTech',
        story: 'Walking up to the sign outside the convention center.',
    },
    IMG_4833: {
        title: 'On the back of the camera',
        story: 'Checking the frame on the photographer\'s screen against the green wall.',
    },
    IMG_4860: {
        title: 'On the floor',
        story: 'Lanyards on, somewhere in the middle of the expo hall.',
    },
    IMG_3697: {
        title: 'Behind the table',
        story: 'The group behind the Voltage Park table, lanyards on.',
    },
    IMG_3733: {
        title: 'Between sessions',
        story: 'Two of us, lanyards still on, somewhere off the main floor.',
    },
    IMG_4512: {
        title: 'Rubber duck',
        story: 'Holding the duck, which is either a joke about debugging or the most honest tool in the building.',
    },
    IMG_4097: {
        title: 'At the podium',
        story: 'Red sweatshirt, boom mic overhead, talking through something.',
    },
    IMG_4323: {
        title: 'At the table',
        story: 'Two of us with whatever we just picked up, the hall still busy behind.',
    },
    IMG_4519: {
        title: 'Library, late',
        story: 'Two people flat out on orange mats on the floor, one still upright at the table. You can guess how the night was going.',
    },
    IMG_4038: {
        title: 'The setup',
        story: 'Editor open on one side, a call on the other, and a sticker on the desk that says it is going to be ok.',
    },
    IMG_4756: {
        title: 'On a call',
        story: 'A product page up on the big screen, me in the corner of the call in red.',
    },
    IMG_4524: {
        title: 'Artificially intelligent',
        story: 'A cap that says exactly that, which I did not make but did keep.',
    },

    // --- home and everything else ---
    IMG_2962: {
        title: 'Sprite, in Amharic',
        story: 'The label in Amharic, most of the bottle already gone.',
    },
    IMG_4528: {
        title: 'The platter',
        story: 'Injera under everything, the sides laid out around the edge, rolls of it on the side.',
    },
    IMG_3779: {
        title: 'Under glass',
        story: 'A gilded crown in a museum case, the label written in Amharic.',
    },
    IMG_3888: {
        title: 'You\'re safe for now',
        story: 'The subtitle was too good not to photograph.',
    },
    IMG_3802: {
        title: 'Checked shirt',
        story: 'Mirror, hallway, phone up.',
    },
    IMG_3803: {
        title: 'Rugby stripes',
        story: 'Same idea, different mirror.',
    },
};
