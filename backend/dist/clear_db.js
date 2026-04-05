"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('--- Database Cleanup Started ---');
    try {
        // 1. Delete IdentityMapping (references Visitor and User)
        console.log('Deleting IdentityMappings...');
        await prisma.identityMapping.deleteMany({});
        // 2. Delete Event (references Session)
        console.log('Deleting Events...');
        await prisma.event.deleteMany({});
        // 3. Delete Session (references Visitor)
        console.log('Deleting Sessions...');
        await prisma.session.deleteMany({});
        // 4. Delete Visitor
        console.log('Deleting Visitors...');
        await prisma.visitor.deleteMany({});
        // 5. Delete User
        console.log('Deleting Users...');
        await prisma.user.deleteMany({});
        console.log('--- Database Cleanup Completed Successfully ---');
    }
    catch (error) {
        console.error('--- Database Cleanup Failed ---');
        console.error(error);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
